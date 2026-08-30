declare module "ffmpeg-static" {
  const path: string | null;
  export default path;
}

declare module "ffprobe-static" {
  interface FfprobeStatic {
    path: string;
  }
  const ffprobeStatic: FfprobeStatic;
  export default ffprobeStatic;
}
