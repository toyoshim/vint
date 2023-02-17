# All Your File Are Belong To Us

## Overview
This is a library part to access several filesystem on several image files
on several stroages. To realize the flexibility to support any, it consists of
3 layers, `Io`, `Image`, and `Fs`.

## APIs
### Io
The Io API handles single storage. It may be a file, or a raw disk. So this API
will be an entry point to access actual data.

```webidl
dictionary IoAttributes {
  DOMString name;
  unsigned long long size;
  Date lastModified;
};

interface Io {
  async IoAttributes getAttributes();
  async seek(unsigned long long offset);
  async ArrayBuffer read(unsigned long long offset);
  async write(ArrayBuffer buffer);
  async truncate(unsigned long long size);
  async flush();
  async close();
};
```

### Image
The Image API handles virtual disk images, such as XDF, DCU, and so on. It takes
an `Io` instance to access actual data, and provides APIs to access virtual
disks that allow per-sector access.

```webidl
dictionary ImageAttributes {
  unsigned long bytesPerSector;
  unsigned long sectorsPerTrack;
  unsigned long tracks;
  DOMString name;
};

interface Image {
  async open(Io io);
  async read(unsigned long long sector);
  async write(unsigned long long sector, ArrayBuffer data);
  async flush();
  async ImageAttributes getAttributes();
};
```

### FS
The Fs API handles file system, such as FAT. It takes an `Image` instance to
access a virtual disk and recognize the file system to give APIs to list
directory and file information, navigate in the directory tree, and access
to a file. It gives a `Io` interface for each file access. Thus, you can
access internal virtual images nad file systems recursively.

```webidl
dictionary FsAttributes {
  DOMString encoiding;
  DOMString volumeLabel;
};

dictionary FsListAttributes {
  DOMString name;
  Boolean writable;
  Boolean readable;
  Boolean system;
  Boolean volume;
  Boolean directory;
  Boolean archive;
  optional Date created;
  optional Date accessed;
  Date modified;
  unsigned long long size;
  Boolean mount;
};

dictionary FsMkdirOptions {
  optional Boolean writable;
  optional Boolean readable;
  optional Boolean system;
  optional Date created;
  optional Date accessed;
  optional Date modified;
};

dictionary FsGetIoOptions : FsMkdirOptions {
  optional Boolean create;
};

function FsListCallback(FsListAttributes attributes) : bool;

interface Fs {
  async open(Image image);
  async list(FsListCallback);
  async chdir(DOMString name);
  async mkdir(DOMString name, FsMkdirOptions? options);
  async remove(DOMString name);
  async getIo(DOMString name, FsGetIoOptions? options);
  async flush();
  async close();
  async FsAttributes getAttributes();
  async DOMString getCwd();
};
```
