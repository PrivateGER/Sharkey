import type { SourceAPI } from './source-api.d.ts';
import type { DataLoadOptions, URLLoadOptions } from '../config/index.d.ts';
declare global {
    interface Window {
        /**
         * The public API for generating a ruffle player.
         * This may be a config holder, which will be converted to a
         * {@link PublicAPI} via {@link installRuffle}, or an actual
         * {@link PublicAPI} instance itself.
         */
        RufflePlayer?: PublicAPILike | PublicAPI;
    }
}
/**
 * Represents a potential installation of a Ruffle public API.
 *
 * Unlike {@link PublicAPI}, this may come from any source, past or future.
 * It needs to be forwards compatible and convertible into a modern day {@link PublicAPI}.
 */
export interface PublicAPILike {
    config?: DataLoadOptions | URLLoadOptions | object;
    sources?: Record<string, SourceAPI>;
    invoked?: boolean;
    newestName?: string | null;
    superseded?(): void;
}
/**
 * Represents the Ruffle public API.
 *
 * The public API exists primarily to allow multiple installations of Ruffle on a
 * page (e.g. an extension install and a local one) to cooperate. In an ideal
 * situation, all Ruffle sources on the page install themselves into a single
 * public API, and then the public API picks the newest version by default.
 *
 * This API *is* versioned, in case we need to upgrade it. However, it must be
 * backwards- and forwards-compatible with all known sources.
 */
export declare class PublicAPI implements PublicAPILike {
	/**
     * The configuration object used when Ruffle is instantiated.
     */
	config: DataLoadOptions | URLLoadOptions | object;
	sources: Record<string, SourceAPI>;
	invoked: boolean;
	newestName: string | null;
	/**
     * Construct the Ruffle public API.
     *
     * Do not use this function to negotiate a public API. Instead, use
     * `public_api` to register your Ruffle source with an existing public API
     * if it exists.
     *
     * Constructing a Public API will also trigger it to initialize Ruffle once
     * the page loads, if the API has not already been superseded.
     *
     * @param prev What used to be in the public API slot.
     *
     * This is used to upgrade from a prior version of the public API, or from
     * a user-defined configuration object placed in the public API slot.
     */
	constructor(prev?: PublicAPILike | null);
	/**
     * The version of the public API.
     *
     * This is *not* the version of Ruffle itself.
     *
     * This allows a page with an old version of the Public API to be upgraded
     * to a new version of the API. The public API is intended to be changed
     * very infrequently, if at all, but this provides an escape mechanism for
     * newer Ruffle sources to upgrade older installations.
     *
     * @returns The version of this public API.
     */
	get version(): string;
	/**
     * Determine the name of the newest registered source in the Public API.
     *
     * @returns The name of the source, or `null` if no source
     * has yet to be registered.
     */
	newestSourceName(): string | null;
	/**
     * Negotiate and start Ruffle.
     *
     * This function reads the config parameter to determine which polyfills
     * should be enabled. If the configuration parameter is missing, then we
     * use a built-in set of defaults sufficient to fool sites with static
     * content and weak plugin detection.
     */
	init(): void;
	/**
     * Look up the newest Ruffle source and return it's API.
     *
     * @returns An instance of the Source API.
     */
	newest(): SourceAPI | null;
	/**
     * Look up a specific Ruffle version (or any version satisfying a given set
     * of requirements) and return it's API.
     *
     * @param requirementString A set of semantic version requirement
     * strings that the player version must satisfy.
     * @returns An instance of the Source API, if one or more
     * sources satisfied the requirement.
     */
	satisfying(requirementString: string): SourceAPI | null;
	/**
     * Look up the newest Ruffle version compatible with the `local` source, if
     * it's installed. Otherwise, use the latest version.
     *
     * @returns An instance of the Source API
     */
	localCompatible(): SourceAPI | null;
	/**
     * Look up the newest Ruffle version with the exact same version as the
     * `local` source, if it's installed. Otherwise, use the latest version.
     *
     * @returns An instance of the Source API
     */
	local(): SourceAPI | null;
	/**
     * Indicates that this version of the public API has been superseded by a
     * newer version.
     *
     * This should only be called by a newer version of the Public API.
     * Identical versions of the Public API should not supersede older versions
     * of that same API.
     *
     * Unfortunately, we can't disable polyfills after-the-fact, so this
     * only lets you disable the init event...
     */
	superseded(): void;
}
