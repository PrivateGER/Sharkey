/**
 * Options to use with this specific installation of Ruffle.
 *
 * This is mostly to provide a way to configure environmental settings, like using
 * `onFirstLoad` to potentially configure webpack prior to loading wasm files.
 */
export interface InstallationOptions {
    /**
     * A callback to be run before the very first time Ruffle is loaded.
     * This may be used to configure a bundler prior to asset loading.
     */
    onFirstLoad?: () => void;
}
/**
 * Install this version of Ruffle into the current page.
 *
 * Multiple (or zero) versions of Ruffle may be installed at the same time,
 * and you should use `window.RufflePlayer.newest()` or similar to access the appropriate
 * installation at time of use.
 *
 * @param sourceName The name of this particular
 * Ruffle source. Common convention is "local" for websites that bundle their own Ruffle,
 * "extension" for browser extensions, and something else for other use cases.
 * Names are unique, and last-installed will replace earlier installations with the same name,
 * regardless of what those installations are or which version they represent.
 * @param options Any options used to configure this specific installation of Ruffle.
 */
export declare function installRuffle(sourceName: string, options?: InstallationOptions): void;
