// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

export class FatFsIo {
  #options = null;
  #offset = 0;  // file read/write position.
  #cluster = 0;  // current tracking cluster ID.
  #clusterOffset = 0;  // cluster start point offset from the file start.
  #data = null;

  constructor(options) {
    this.#options = options;  // We may want up-to-date size in the future, but.
    this.#cluster = options.startCluster;
  }

  async getAttributes() {
    return {
      name: this.#options.name,
      size: this.#options.size,
      lastModified: this.#options.lastModified
    };
  }

  async seek(offset) {
    this.#offset = Math.min(offset, this.#options.size);
  }

  async read(size) {
    await this.#seekToCurrentCluster();
    const remainingSize = this.#options.size - this.#offset;
    const readSize = Math.min(size, remainingSize);
    const dst = new Uint8Array(readSize);
    let writeOffset = 0;
    while (writeOffset < readSize) {
      await this.#readCurrentCluster();
      const offset = this.#offset - this.#clusterOffset;
      const endOffset = Math.min(offset + readSize, this.#data.data.byteLength);
      for (let i = offset; i < endOffset; ++i) {
        dst[writeOffset++] = this.#data.data[i];
      }
      this.#offset += endOffset - offset;
      if (writeOffset != readSize) {
        await this.#seekToNextCluster();
      }
    }
    return dst.buffer;
  }

  async write(buffer) {
    await this.#seekToCurrentCluster();
    const src = new Uint8Array(buffer);
    let writeOffset = 0;
    while (writeOffset < buffer.byteLength) {
      await this.#readCurrentCluster();
      const offset = this.#offset - this.#clusterOffset;
      const endOffset =
        Math.min(offset + buffer.byteLength, this.#data.data.byteLength);
      for (let i = offset; i < endOffset; ++i) {
        this.#data.data[i] = src[writeOffset++];
      }
      const writeSize = endOffset - offset;
      this.#offset += writeSize;
      this.#options.size += writeSize;
      const bytesPerSector = this.#options.bytesPerSector;
      this.#data.dirty[(offset / bytesPerSector) | 0] = true;
      this.#data.dirty[((endOffset - 1) / bytesPerSector) | 0] = true;
      for (let i = 0; i < this.#options.sectorsPerCluster; ++i) {
        if (!this.#data.dirty[i]) {
          continue;
        }
        const start = i * bytesPerSector;
        const end = start + bytesPerSector;
        await this.#options.writeSector(
          this.#data.sectors[i],
          this.#data.data.slice(start, end).buffer);
        this.#data.dirty[i] = false;
      }
    }
    await this.#options.updateEntry({ size: this.#options.size });
    await this.#options.flushEntry();
  }

  async truncate(size) {
    throw Error.createNotImplemented('truncate');
  }

  async flush() {
    await this.#options.flush();
  }

  async close() {
    await this.#options.flush();
    this.#options = null;
    this.#offset = 0;
    this.#cluster = 0;
    this.#clusterOffset = 0;
    this.#data = null;
  }

  #calculateBlockSize(size) {
    const blockSize =
      this.#options.bytesPerSector * this.#options.sectorsPerCluster;
    return ((size + blockSize - 1) / blockSize) | 0;
  }

  async #seekToNextCluster() {
    this.#cluster = await this.#options.getFat(this.#cluster);
    if (this.#cluster == 0 || this.#cluster == 0xfff) {
      throw Error.createInvalidFormat('unexpected fat link end');
    }
    this.#clusterOffset +=
      this.#options.bytesPerSector * this.#options.sectorsPerCluster;
    this.#data = null;
  }

  async #seekToCurrentCluster() {
    if ((this.#offset < this.#clusterOffset) || (this.#options.size == 0)) {
      // Need to follow the fat link from the start point to go back.
      this.#cluster = this.#options.startCluster;
      this.#clusterOffset = 0;
      this.#data = null;
      if (!this.#cluster || !this.#options.size) {
        return;
      }
    }
    const bytesPerCluster =
      this.#options.bytesPerSector * this.#options.sectorsPerCluster;
    while ((this.#clusterOffset + bytesPerCluster) <= this.#offset) {
      await this.#seekToNextCluster();
    }
  }

  async #readCurrentCluster() {
    if (this.#data) {
      return;
    }
    if (this.#options.size <= this.#offset) {
      // Allocate a new cluster.
      const cluster = await this.#options.findAvailableCluster();
      if (this.#cluster == 0) {
        await this.#options.updateEntry({ startCluster: cluster });
        this.#clusterOffset = 0;
      } else {
        await this.#options.setFat(this.#cluster, cluster);
        await this.#options.setFat(this.#cluster, 0xfff);
        await this.#options.flushFat();
        this.#clusterOffset +=
          this.#options.bytesPerSector * this.#options.sectorsPerCluster;
      }
      this.#cluster = cluster;
    }
    this.#data = await this.#options.readClusters(this.#cluster, 1);
    if (!this.#data || this.#data.data.byteLength == 0) {
      throw Error.createInvalidFormat();
    }
  }
} 