declare module "screenshot-desktop" {
  function screenshotDesktop(options?: { format?: string }): Promise<Buffer>;
  namespace screenshotDesktop {
    function all(): Promise<Buffer[]>;
  }
  export default screenshotDesktop;
}
