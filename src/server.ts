// Load .env before anything reads process.env. Without this every setting
// silently fell back to its default - including AUTH_SECRET.
try {
  process.loadEnvFile();
} catch {
  // No .env file: defaults apply.
}

export {};

const { createApp } = await import("./app.js");

const port = Number(process.env.PORT ?? 4000);

// Bound to 0.0.0.0 so a phone on the same wifi can reach it.
createApp().listen(port, "0.0.0.0", () => {
  console.log(`API listening on http://0.0.0.0:${port}/api`);
});
