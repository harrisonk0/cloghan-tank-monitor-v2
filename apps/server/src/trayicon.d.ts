declare module "trayicon" {
  interface TrayItemOptions {
    checked?: boolean;
    disabled?: boolean;
    bold?: boolean;
    action?: () => void;
  }

  interface Tray {
    item(label: string, opts?: TrayItemOptions): TrayItem;
    separator(): TrayItem;
    setMenu(...items: TrayItem[]): void;
    setTitle(title: string): void;
    setIcon(iconBuffer: Buffer): void;
    notify(title: string, message: string): void;
    kill(): void;
    on(event: string, listener: (...args: unknown[]) => void): Tray;
  }

  interface TrayItem {
    add(...children: TrayItem[]): void;
  }

  interface TrayCreateOptions {
    icon?: Buffer;
    title?: string;
    action?: () => void;
    useTempDir?: boolean | "clean";
  }

  function create(opts: TrayCreateOptions, cb?: (tray: Tray) => void): Promise<Tray>;
  export = { create };
}
