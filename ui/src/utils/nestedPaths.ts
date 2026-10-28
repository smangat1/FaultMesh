/**
 * Utility functions for handling nested directory structures and disambiguating
 * file names across folders in FaultMesh.
 */

export interface FolderGroup<T extends { path: string }> {
  folder: string;
  label: string;
  files: T[];
}

/**
 * Returns the directory part of a relative file path.
 * e.g. "sub/c.py" -> "sub", "outer/inner/b.py" -> "outer/inner", "a.py" -> "."
 */
export function getFileFolder(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : '.';
}

/**
 * Disambiguates file names when multiple files across folders share the same basename.
 * e.g. for ["a.py", "sub/a.py"], "a.py" stays "a.py" and "sub/a.py" becomes "sub/a.py".
 * If unique, uses the file basename.
 */
export function disambiguateFileNames(filePaths: string[]): Map<string, string> {
  const basenameCounts = new Map<string, number>();
  for (const path of filePaths) {
    const normalized = path.replace(/\\/g, '/');
    const base = normalized.split('/').pop() || normalized;
    basenameCounts.set(base, (basenameCounts.get(base) || 0) + 1);
  }

  const result = new Map<string, string>();
  for (const path of filePaths) {
    const normalized = path.replace(/\\/g, '/');
    const base = normalized.split('/').pop() || normalized;
    if ((basenameCounts.get(base) || 0) > 1) {
      result.set(path, normalized);
    } else {
      result.set(path, base);
    }
  }
  return result;
}

/**
 * Formats the live watching status line based on total Python files and folder count.
 * e.g.:
 * - 0 files: "No Python files found in this folder. Pick the folder that contains your .py code."
 * - 4 files in 2 folders: "Watching 4 Python files in 2 folders"
 * - 1 file in 1 folder: "Watching 1 Python file in 1 folder"
 */
export function formatWatchingStatus(files: Array<{ path: string }>): string {
  if (!files || files.length === 0) {
    return 'No Python files found in this folder. Pick the folder that contains your .py code.';
  }
  const folderSet = new Set<string>();
  for (const f of files) {
    folderSet.add(getFileFolder(f.path));
  }
  const folderCount = folderSet.size;
  const fileStr = `${files.length} Python ${files.length === 1 ? 'file' : 'files'}`;
  const folderStr = folderCount === 1 ? '1 folder' : `${folderCount} folders`;
  return `Watching ${fileStr} in ${folderStr}`;
}

/**
 * Groups files into collapsible folder buckets.
 * Root folder (".") appears first as "root", followed by subfolders in alphabetical order.
 */
export function groupFilesByFolder<T extends { path: string }>(files: T[]): FolderGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const file of files) {
    const folder = getFileFolder(file.path);
    if (!groups.has(folder)) {
      groups.set(folder, []);
    }
    groups.get(folder)!.push(file);
  }

  const sortedFolders = Array.from(groups.keys()).sort((a, b) => {
    if (a === '.' && b !== '.') return -1;
    if (b === '.' && a !== '.') return 1;
    return a.localeCompare(b);
  });

  return sortedFolders.map((folder) => {
    const label = folder === '.' ? 'root' : `${folder}/`;
    return {
      folder,
      label,
      files: groups.get(folder) || [],
    };
  });
}
