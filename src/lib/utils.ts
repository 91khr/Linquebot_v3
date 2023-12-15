import fs, { PathLike } from 'fs';
import { access } from 'fs/promises';

/**
 * Check if a file can be accessed with the given permission
 */
export async function can_access(path: PathLike, perm: number = fs.constants.R_OK) {
  try {
    await access(path, perm);
    return true;
  } catch (_) {
    return false;
  }
}
