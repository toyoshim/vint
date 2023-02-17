# All Your File Are Belong To Us

## Overview
This is a library part to access several filesystem on several image files
on several stroages. To realize the flexibility to support any, it consists of
3 layers, `Io`, `Image`, and `Fs`.

## APIs
### Io
The Io API handles single storage. It may be a file, or a raw disk. So this API
will be an entry point to access actual data.

### Image
The Image API handles virtual disk images, such as XDF, DCU, and so on. It takes
an `Io` instance to access actual data, and provides APIs to access virtual
disks that allow per-sector access.

### FS
The Fs API handles file system, such as FAT. It takes an `Image` instance to
access a virtual disk and recognize the file system to give APIs to list
directory and file information, navigate in the directory tree, and access
to a file. It gives a `Io` interface for each file access. Thus, you can
access internal virtual images nad file systems recursively.