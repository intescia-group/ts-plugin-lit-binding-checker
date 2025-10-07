import type ts from 'typescript/lib/tsserverlibrary';


export interface PluginOptions {
/** Ignore mismatches that are only due to `| undefined`. */
ignoreUndefined?: boolean;
/** Ignore attribute checks (only keep .prop checks). */
ignoreAttribute?: boolean;
/** Print lightweight cache traces to tsserver log. */
debugCache?: boolean;
}

export type TS = typeof ts;
