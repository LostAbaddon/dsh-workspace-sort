/**
 * Host loader entry for dsh-workspace-sort.
 *
 * The whole feature lives in the browser half (`lib/client.js`): it reorders
 * workspace groups through the shipped Client Workspace service and folds each
 * workspace's visible conversation count in the rendered sidebar. This half
 * exists only so the Loader owns a row for the package (which is what makes the
 * browser half get served), so it deliberately mounts no service, no tool and
 * no route — a failure here cannot take the profile down.
 */
export function apply() {}
