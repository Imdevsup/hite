/**
 * `ffprobe-static` ships no type declarations (its sibling `ffmpeg-static` does). This is the whole
 * public surface of the package — a single resolved absolute path to the platform's binary.
 */
declare module "ffprobe-static" {
  const ffprobe: { path: string };
  export default ffprobe;
}
