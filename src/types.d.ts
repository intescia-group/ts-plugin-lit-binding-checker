import type ts from 'typescript/lib/tsserverlibrary';


export interface PluginOptions {
/** Ignore mismatches that are only due to `| undefined`. */
ignoreUndefined?: boolean;
/** Ignore attribute checks (only keep .prop checks). */
ignoreAttribute?: boolean;
/** Ignore event binding checks. */
ignoreEvent?: boolean;
/** Print lightweight cache traces to tsserver log. */
debugCache?: boolean;
/** List of regex patterns to ignore files. */
ignoreFiles?: string[];
}

export type TS = typeof ts;
