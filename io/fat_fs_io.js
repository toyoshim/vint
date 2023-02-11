// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

export class FatFsIo {
  #options = null;
  #offset = 0;
  #cluster = 0;
  #clusterOffset = 0;
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
    this.#offset = offset;
  }

  async read(size) {
    const remainingSize = this.#options.size - this.#offset;
    const readSize = Math.min(size, remainingSize);
    if (this.#offset < this.#clusterOffset) {
      // Need to follow the fat link from the start point to go back.
      this.#cluster = this.#options.startCluster;
      this.#clusterOffset = 0;
      this.#data = null;
    }
    const bytesPerCluster = this.#options.bytesPerCluster;
    const buffer = new ArrayBuffer(readSize);
    const dst = new Uint8Array(buffer);
    let writeOffset = 0;
    while (writeOffset < readSize) {
      // Find the start cluster to read.
      while ((this.#clusterOffset + bytesPerCluster) < this.#offset) {
        this.#cluster = await this.#options.getFat(this.#cluster);
        if (this.#cluster == 0 || this.#cluster == 0xfff) {
          throw Error.createInvalidFormat('unexpected fat link end');
        }
        this.#clusterOffset += bytesPerCluster;
        this.#data = null;
      }
      if (!this.#data) {
        const clusters = await this.#options.readClusters(this.#cluster, 1);
        this.#data = clusters ? clusters.data : null;
        if (!this.#data || this.#data.byteLength == 0) {
          return null;
        }
      }
      const offset = this.#offset - this.#clusterOffset;
      const endOffset = Math.min(offset + readSize, this.#data.byteLength);
      for (let i = offset; i < endOffset; ++i) {
        dst[writeOffset++] = this.#data[i];
      }
      this.#offset += endOffset - offset;
    }
    return dst;
  }

  async write(buffer) {
    throw Error.createNotImplemented('write');
  }

  async truncate(size) {
    throw Error.createNotImplemented('truncate');
  }

  async flush() {
    throw Error.createNotImplemented('flush');
  }

  async close() {
    throw Error.createNotImplemented('close');
  }
} 