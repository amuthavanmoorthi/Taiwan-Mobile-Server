#!/usr/bin/env python3
"""
3D Gaussian Splatting .ply -> watertight-ish coloured mesh .ply

Gary's pipeline stops at 3DGS. AR Quick Look on iOS renders meshes, not
splats, so something has to bridge the two; this is that step. It is
deliberately CPU-only — SuGaR and the other published splat-to-mesh methods
want CUDA, which no machine on this project has.

Approach: treat the splat centres as an oriented point cloud and run screened
Poisson over it. That throws away the anisotropy and view-dependent colour
that make 3DGS look good, which is exactly why the splat file stays the
viewer's source and this output is only ever the AR proxy.

Input quality decides everything. A whole scene full of floaters reconstructs
into blobs. One object, background removed in SuperSplat, reconstructs fine.

Usage:
    splat_reconstruct.py --input <3dgs.ply> --output <mesh.ply>
                         [--target-tris N] [--depth N]
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
import open3d as o3d


def log(*a):
    """Progress goes to stderr; stdout stays machine-readable."""
    print(*a, file=sys.stderr, flush=True)


def die(msg):
    print(msg, file=sys.stderr, flush=True)
    sys.exit(1)


def read_3dgs(path):
    """Parse the vanilla 3DGS ply layout: xyz, normals, SH, opacity, scale, rot."""
    with open(path, "rb") as fh:
        hdr = b""
        while b"end_header" not in hdr:
            chunk = fh.read(512)
            if not chunk:
                die("Not a PLY file, or the header never ended.")
            hdr += chunk
            if len(hdr) > 1 << 20:
                die("PLY header is implausibly long.")

        end = hdr.index(b"end_header\n") + len(b"end_header\n")
        if b"binary_little_endian" not in hdr[:end]:
            die("Only binary_little_endian PLY files are supported.")

        names = [p.decode() for p in re.findall(rb"property float (\w+)", hdr[:end])]
        m = re.search(rb"element vertex (\d+)", hdr[:end])
        if not m:
            die("PLY header has no vertex count.")
        n = int(m.group(1))

        for required in ("x", "y", "z", "opacity", "scale_0", "f_dc_0"):
            if required not in names:
                die(
                    f"This does not look like a 3D Gaussian Splatting file "
                    f"(no '{required}' property). Export the splat .ply from "
                    f"the training run or SuperSplat."
                )

        fh.seek(end)
        data = np.fromfile(fh, dtype=np.float32, count=n * len(names))

    if data.size != n * len(names):
        die("PLY is truncated — the vertex data is shorter than the header claims.")

    data = data.reshape(n, len(names))
    i = {k: j for j, k in enumerate(names)}

    xyz = data[:, [i["x"], i["y"], i["z"]]].astype(np.float64)
    # SH band 0 -> linear colour. 0.2820948 is the band-0 basis constant.
    dc = data[:, [i["f_dc_0"], i["f_dc_1"], i["f_dc_2"]]]
    rgb = np.clip(0.5 + 0.2820948 * dc, 0, 1).astype(np.float64)
    opacity = 1.0 / (1.0 + np.exp(-data[:, i["opacity"]]))
    radius = np.exp(data[:, [i["scale_0"], i["scale_1"], i["scale_2"]]]).max(axis=1)
    return xyz, rgb, opacity, radius


def clean(xyz, rgb, opacity, radius, min_opacity, radius_pct):
    """
    Keep splats that describe a surface.

    Low-opacity splats are the haze 3DGS uses to fake soft edges and
    ambient light; they sit off the surface and drag Poisson with them.
    Oversized splats are almost always floaters or sky.
    """
    keep = opacity > min_opacity
    if keep.sum() < 1000:
        # Nothing is opaque enough — better to relax than to fail outright.
        cutoff = np.quantile(opacity, 0.75)
        keep = opacity >= cutoff
        log(f"  few opaque splats; relaxed opacity cutoff to {cutoff:.3f}")

    limit = np.percentile(radius[keep], radius_pct)
    keep &= radius <= limit
    return xyz[keep], rgb[keep], int(keep.sum())


def largest_component(mesh, keep_ratio=0.05):
    """
    Drop disconnected shells.

    Poisson emits a blob for every isolated clump of points, so a single
    leftover floater becomes a lump hanging in the air next to the chair.
    """
    labels, counts, _ = mesh.cluster_connected_triangles()
    labels = np.asarray(labels)
    counts = np.asarray(counts)
    if counts.size <= 1:
        return mesh, 1

    biggest = counts.max()
    doomed = np.isin(labels, np.where(counts < biggest * keep_ratio)[0])
    mesh.remove_triangles_by_mask(doomed)
    mesh.remove_unreferenced_vertices()
    return mesh, int((counts >= biggest * keep_ratio).sum())


def poisson_worker(argv):
    """
    Child-process half: Poisson plus the density crop, nothing else.

    Poisson closes the surface everywhere, inventing geometry behind and
    beneath the object where no camera ever looked. Those vertices have almost
    no point support, so cutting the lowest density removes that balloon while
    leaving the real surface. Done here so the parent only ever sees a
    finished mesh or a missing file.
    """
    ap = argparse.ArgumentParser()
    ap.add_argument("--poisson-worker", action="store_true")
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--depth", type=int, required=True)
    ap.add_argument("--density-quantile", type=float, default=0.12)
    a = ap.parse_args(argv)

    pcd = o3d.io.read_point_cloud(a.input)
    if len(pcd.points) == 0:
        die("Staged point cloud was empty.")

    mesh, density = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd, depth=a.depth
    )
    if len(mesh.triangles) == 0:
        die("No surface produced.")

    density = np.asarray(density)
    mesh.remove_vertices_by_mask(density < np.quantile(density, a.density_quantile))
    mesh.remove_unreferenced_vertices()
    if len(mesh.triangles) == 0:
        die("Density crop removed the whole surface.")

    o3d.io.write_triangle_mesh(a.output, mesh, write_vertex_colors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--target-tris", type=int, default=60_000)
    ap.add_argument("--depth", type=int, default=9, help="Poisson octree depth")
    ap.add_argument("--min-opacity", type=float, default=0.5)
    ap.add_argument("--radius-pct", type=float, default=92.0)
    ap.add_argument(
        "--voxel-ratio",
        type=float,
        default=0.0015,
        help="Voxel size as a fraction of the bounding-box diagonal. 0 disables.",
    )
    ap.add_argument(
        "--density-quantile",
        type=float,
        default=0.12,
        help="Fraction of least-supported vertices to cut after Poisson.",
    )
    args = ap.parse_args()

    log("reading splats…")
    xyz, rgb, opacity, radius = read_3dgs(args.input)
    log(f"  {len(xyz)} splats")

    xyz, rgb, kept = clean(xyz, rgb, opacity, radius, args.min_opacity, args.radius_pct)
    log(f"  {kept} kept after opacity/size filtering")
    if kept < 500:
        die("Too few solid splats to reconstruct a surface from.")

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(xyz)
    pcd.colors = o3d.utility.Vector3dVector(rgb)

    pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
    log(f"  {len(pcd.points)} after outlier removal")
    if len(pcd.points) < 500:
        die("Outlier removal left too little to reconstruct.")

    # 3DGS writes the normal fields as zeros, so they have to be estimated.
    # Consistent orientation matters more than accuracy here: Poisson reads the
    # normal as which side is outside, and a mixed-up cloud turns inside out.
    log("estimating normals…")
    pcd.estimate_normals(o3d.geometry.KDTreeSearchParamKNN(knn=30))
    pcd.orient_normals_consistent_tangent_plane(30)

    # Near-duplicate points are what make Open3D's Poisson abort with
    # "Failed to close loop": several samples land in one cell and the
    # isosurface walker cannot pick an edge. Splat centres cluster hard where
    # the scan saw a surface from many frames, so this is the normal case, not
    # an edge case. A voxel grid at a fraction of the model size regularises
    # the density and costs nothing in detail.
    diag = np.linalg.norm(
        pcd.get_axis_aligned_bounding_box().get_extent()
    )
    voxel = diag * args.voxel_ratio
    if voxel > 0:
        before = len(pcd.points)
        pcd = pcd.voxel_down_sample(voxel)
        log(f"  {before} -> {len(pcd.points)} after voxel downsample ({voxel:.4f} units)")
        if len(pcd.points) < 500:
            die("Downsampling left too few points — the scan is very sparse.")
        # Downsampling drops the normals' orientation consistency, so redo it.
        pcd.estimate_normals(o3d.geometry.KDTreeSearchParamKNN(knn=30))
        pcd.orient_normals_consistent_tangent_plane(30)

    # Poisson runs in a child process on purpose.
    #
    # Open3D bundles PoissonRecon, whose error path is ERROR_OUT -> exit(0).
    # A "Failed to close loop" therefore kills the interpreter silently: no
    # exception to catch, no traceback, and a zero exit code that looks like
    # success. Isolating it means a failure is just a child that produced no
    # file, which we can see and retry at a coarser depth.
    with tempfile.TemporaryDirectory() as tmp:
        cloud_path = os.path.join(tmp, "cloud.ply")
        if not o3d.io.write_point_cloud(cloud_path, pcd):
            die("Could not stage the point cloud for reconstruction.")

        mesh = None
        for depth in range(args.depth, max(args.depth - 3, 5), -1):
            log(f"poisson reconstruction (depth {depth})…")
            mesh_path = os.path.join(tmp, f"mesh{depth}.ply")
            proc = subprocess.run(
                [
                    sys.executable, os.path.abspath(__file__),
                    "--poisson-worker",
                    "--input", cloud_path,
                    "--output", mesh_path,
                    "--depth", str(depth),
                    "--density-quantile", str(args.density_quantile),
                ],
                capture_output=True,
                text=True,
            )
            if os.path.exists(mesh_path):
                mesh = o3d.io.read_triangle_mesh(mesh_path)
                if len(mesh.triangles) > 0:
                    break
                mesh = None
            tail = [l for l in (proc.stderr or "").splitlines() if l.strip()]
            log(f"  depth {depth} failed: {tail[-1] if tail else 'no surface produced'}")

    if mesh is None or len(mesh.triangles) == 0:
        die(
            "Poisson reconstruction produced no surface at any depth. The scan "
            "is probably too sparse or too noisy — crop it to the single item "
            "in SuperSplat and remove stray splats."
        )
    log(f"  {len(mesh.triangles)} triangles")

    mesh, shells = largest_component(mesh)
    log(f"  {shells} shell(s) kept, {len(mesh.triangles)} triangles")

    if len(mesh.triangles) > args.target_tris:
        mesh = mesh.simplify_quadric_decimation(args.target_tris)

    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()
    mesh.compute_vertex_normals()

    if len(mesh.triangles) == 0:
        die("Cleaning removed the whole mesh — the input is too sparse or too noisy.")

    if not mesh.has_vertex_colors():
        die("Reconstruction lost vertex colours.")

    extent = mesh.get_axis_aligned_bounding_box().get_extent()
    log(
        f"final: {len(mesh.triangles)} triangles, {len(mesh.vertices)} vertices, "
        f"extent {np.round(extent, 3)}"
    )

    if not o3d.io.write_triangle_mesh(args.output, mesh, write_vertex_colors=True):
        die(f"Could not write {args.output}.")


if __name__ == "__main__":
    if "--poisson-worker" in sys.argv:
        poisson_worker(sys.argv[1:])
    else:
        main()
