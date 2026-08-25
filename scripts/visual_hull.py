#!/usr/bin/env python3
"""
Multi-view silhouette carving: several photos around an object -> a mesh.

WHAT THIS IS
------------
Space carving. A voxel block is projected into every silhouette in turn and any
voxel that falls outside one is removed. What survives every view is the visual
hull: the tightest shape consistent with all the outlines. The surface of that
hull is then meshed and coloured from the photographs.

WHY THIS AND NOT PHOTOGRAMMETRY
-------------------------------
Real structure-from-motion needs camera poses, and 3D Gaussian Splatting needs
a CUDA GPU to train. Neither is available here. Silhouette carving needs
neither: no feature matching, no pose solving, no GPU, and it degrades
predictably rather than failing outright on a texture-less white cabinet -
which is exactly the case that defeats feature matching.

WHAT IT CANNOT DO
-----------------
A visual hull can never see concavities. The hollow of a bowl, the gap under a
shelf, the dip in a cushion - none of them change the outline from any angle,
so none of them are carved. Furniture is mostly convex slabs and legs, which is
the case this handles well, but a buyer should not expect the inside of a
cabinet to be modelled.

THE CAPTURE IT ASSUMES
----------------------
Photographs taken at roughly even angles all the way around, camera height and
distance held roughly constant. Projection is treated as orthographic, which
removes any need to know the lens or the distance - at normal shooting range
the error is small, and it is what makes this work with no calibration at all.

Uneven spacing skews the result. Eight shots at 45 degrees is the target; the
video path already samples evenly, which is why it suits this well.

Usage:
    visual_hull.py --masks a.png,b.png --photos a.jpg,b.jpg --output mesh.ply
                   [--resolution 160] [--target-tris 40000]
"""

import argparse
import os
import sys

import numpy as np
import open3d as o3d
from PIL import Image


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def die(msg):
    print(msg, file=sys.stderr, flush=True)
    sys.exit(1)


def load_mask(path):
    """Masks are written as 8-bit greyscale: 255 inside the item."""
    m = np.array(Image.open(path).convert("L"))
    return m > 127


def silhouette_metrics(masks):
    """
    Work out where the turntable axis and the ground plane sit in the images.

    The object's height does not change as it rotates, so it sets the scale.
    The rotation axis projects to the same vertical line in every frame, so the
    median horizontal centroid finds it. Medians rather than means throughout:
    one bad segmentation should not drag the whole reconstruction.
    """
    tops, bottoms, centres = [], [], []
    for m in masks:
        rows = np.where(m.any(axis=1))[0]
        cols = np.where(m.any(axis=0))[0]
        if rows.size == 0 or cols.size == 0:
            continue
        tops.append(rows[0])
        bottoms.append(rows[-1])
        centres.append((cols[0] + cols[-1]) / 2)

    if len(tops) < 3:
        die("Fewer than three photos produced a usable outline.")

    top = float(np.median(tops))
    bottom = float(np.median(bottoms))
    axis_x = float(np.median(centres))
    height_px = bottom - top
    if height_px < 10:
        die("The item is too small in frame to reconstruct. Fill more of the shot.")
    return axis_x, bottom, height_px


def carve(masks, angles, axis_x, ground_y, height_px, res):
    """
    Remove every voxel that falls outside any silhouette.

    The grid is normalised so the object is one unit tall, which keeps the
    resolution meaningful whatever the photographs measured. Absolute size is
    restored later from the operator's measured height.
    """
    # Half-width of the block. Taken from the widest outline seen, with a
    # margin, so a wide sofa is not clipped by a grid sized for a chair.
    half = 0.0
    for m in masks:
        cols = np.where(m.any(axis=0))[0]
        if cols.size:
            half = max(half, max(abs(cols[0] - axis_x), abs(cols[-1] - axis_x)))
    half_units = (half / height_px) * 1.05
    half_units = max(half_units, 0.15)

    ny = res
    nxz = max(8, int(res * half_units * 2))
    log(f"  grid {nxz} x {ny} x {nxz} ({nxz * ny * nxz / 1e6:.1f}M voxels)")

    ys = (np.arange(ny) + 0.5) / ny                       # 0..1, object height
    xs = (np.arange(nxz) + 0.5) / nxz * 2 * half_units - half_units
    zs = xs.copy()

    occupied = np.ones((nxz, ny, nxz), dtype=bool)
    X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")

    for m, theta in zip(masks, angles):
        h, w = m.shape
        # Orthographic: only the horizontal offset from the axis matters, and
        # it is the rotated x-z coordinate.
        u = X * np.cos(theta) + Z * np.sin(theta)
        col = np.rint(axis_x + u * height_px).astype(np.int64)
        row = np.rint(ground_y - Y * height_px).astype(np.int64)

        inside = (col >= 0) & (col < w) & (row >= 0) & (row < h)
        hit = np.zeros_like(occupied)
        hit[inside] = m[row[inside], col[inside]]
        occupied &= hit

        if not occupied.any():
            die(
                "The outlines do not overlap - nothing survived carving. The "
                "photos are probably not all of the same item, or the "
                "background removal failed on some of them."
            )

    return occupied, xs, ys, zs


def surface_points(occupied, xs, ys, zs):
    """
    Keep the voxels on the boundary and give each an outward normal.

    The normal comes from the direction of empty space around the voxel, which
    is cheap and good enough to orient the Poisson reconstruction that follows.
    """
    padded = np.pad(occupied, 1, constant_values=False)
    neighbours = (
        padded[:-2, 1:-1, 1:-1].astype(np.int8)
        + padded[2:, 1:-1, 1:-1]
        + padded[1:-1, :-2, 1:-1]
        + padded[1:-1, 2:, 1:-1]
        + padded[1:-1, 1:-1, :-2]
        + padded[1:-1, 1:-1, 2:]
    )
    shell = occupied & (neighbours < 6)
    idx = np.argwhere(shell)
    if idx.shape[0] < 100:
        die("Too little of the item survived carving to build a surface.")

    pts = np.stack([xs[idx[:, 0]], ys[idx[:, 1]], zs[idx[:, 2]]], axis=1)

    grad = np.stack(
        [
            padded[:-2, 1:-1, 1:-1].astype(np.int8) - padded[2:, 1:-1, 1:-1],
            padded[1:-1, :-2, 1:-1].astype(np.int8) - padded[1:-1, 2:, 1:-1],
            padded[1:-1, 1:-1, :-2].astype(np.int8) - padded[1:-1, 1:-1, 2:],
        ],
        axis=-1,
    )[shell].astype(np.float64)

    norms = np.linalg.norm(grad, axis=1, keepdims=True)
    # A voxel fully surrounded on those six faces has no gradient; point it out
    # from the axis instead, which is right for a turntable capture.
    flat = norms[:, 0] < 1e-9
    grad[flat] = np.stack([pts[flat, 0], np.zeros(flat.sum()), pts[flat, 2]], axis=1)
    norms = np.maximum(np.linalg.norm(grad, axis=1, keepdims=True), 1e-9)
    return pts, grad / norms


def colour_vertices(vertices, normals, photos, masks, angles, axis_x, ground_y, height_px):
    """
    Sample each vertex from the photograph that sees it most squarely.

    Choosing by facing angle rather than blending avoids the smeared double
    exposure that averaging across views produces on anything with a pattern.
    """
    n = len(vertices)
    best = np.full(n, -np.inf)
    colour = np.full((n, 3), 0.72)

    # Open3D can hand back a zero-length normal for a degenerate vertex, which
    # turns the facing test into NaN and silently loses that vertex's colour.
    lengths = np.linalg.norm(normals, axis=1, keepdims=True)
    unit = np.divide(normals, lengths, out=np.zeros_like(normals), where=lengths > 1e-9)
    unit = np.ascontiguousarray(unit)

    for img, m, theta in zip(photos, masks, angles):
        h, w = m.shape
        pix = np.asarray(img.convert("RGB").resize((w, h), Image.BILINEAR), dtype=np.float64) / 255.0

        # The view direction for this frame, in object space.
        view = np.array([np.sin(theta), 0.0, np.cos(theta)])
        # Written out rather than as a matmul: numpy's BLAS path emits
        # spurious divide-by-zero and overflow warnings here, and those end up
        # quoted back to depot staff as the reason a model failed.
        facing = (unit * view).sum(axis=1)

        u = vertices[:, 0] * np.cos(theta) + vertices[:, 2] * np.sin(theta)
        col = np.rint(axis_x + u * height_px).astype(np.int64)
        row = np.rint(ground_y - vertices[:, 1] * height_px).astype(np.int64)

        ok = (
            (facing > best)
            & (facing > 0)
            & (col >= 0) & (col < w)
            & (row >= 0) & (row < h)
        )
        if not ok.any():
            continue
        # Only trust a sample that lands inside the item's own outline.
        ok[ok] &= m[row[ok], col[ok]]
        if not ok.any():
            continue

        colour[ok] = pix[row[ok], col[ok]]
        best[ok] = facing[ok]

    return colour


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--masks", required=True)
    ap.add_argument("--photos", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--resolution", type=int, default=160)
    ap.add_argument("--target-tris", type=int, default=40000)
    args = ap.parse_args()

    mask_paths = [p for p in args.masks.split(",") if p]
    photo_paths = [p for p in args.photos.split(",") if p]

    if len(mask_paths) != len(photo_paths):
        die("Mask and photo counts differ.")
    if len(mask_paths) < 3:
        die("At least three photos taken around the item are needed.")

    masks = [load_mask(p) for p in mask_paths]
    photos = [Image.open(p) for p in photo_paths]

    # Even spacing all the way around is the assumption the whole method rests
    # on; it is stated in the operator's instructions.
    angles = np.linspace(0, 2 * np.pi, len(masks), endpoint=False)

    log(f"carving from {len(masks)} views")
    axis_x, ground_y, height_px = silhouette_metrics(masks)
    occupied, xs, ys, zs = carve(masks, angles, axis_x, ground_y, height_px, args.resolution)
    log(f"  {occupied.sum()} voxels survived ({100 * occupied.mean():.1f}% of the block)")

    pts, normals = surface_points(occupied, xs, ys, zs)
    log(f"  {len(pts)} surface voxels")

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(pts)
    pcd.normals = o3d.utility.Vector3dVector(normals)

    mesh, density = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd, depth=8)
    if len(mesh.triangles) == 0:
        die("Could not build a surface from the carved shape.")

    # Poisson closes over the whole block; the least-supported vertices are the
    # invented parts rather than the carved ones.
    mesh.remove_vertices_by_mask(np.asarray(density) < np.quantile(np.asarray(density), 0.08))
    mesh.remove_unreferenced_vertices()

    if len(mesh.triangles) > args.target_tris:
        mesh = mesh.simplify_quadric_decimation(args.target_tris)
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_vertices()
    mesh.compute_vertex_normals()

    if len(mesh.triangles) == 0:
        die("Cleaning removed the whole surface.")

    verts = np.asarray(mesh.vertices)
    vnorm = np.asarray(mesh.vertex_normals)
    mesh.vertex_colors = o3d.utility.Vector3dVector(
        colour_vertices(verts, vnorm, photos, masks, angles, axis_x, ground_y, height_px)
    )

    extent = mesh.get_axis_aligned_bounding_box().get_extent()
    log(f"final: {len(mesh.triangles)} triangles, extent {np.round(extent, 3)}")

    if not o3d.io.write_triangle_mesh(args.output, mesh, write_vertex_colors=True):
        die(f"Could not write {args.output}.")


if __name__ == "__main__":
    main()
