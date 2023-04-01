// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

const blockSize = 4096;

class StoreBuffer {
  #cache = {};
  #staleCache = {};
  #reader = null;

  constructor(reader) {
    this.#reader = reader;
  }

  async read(offset, size) {
    const dst = new Uint8Array(new ArrayBuffer(size));
    const originOffset = offset;
    const stopOffset = offset + size;

    for (let startOffset = offset; startOffset < stopOffset;) {
      const block = (startOffset / blockSize) | 0;
      const endOffset = (startOffset + blockSize) & ~(blockSize - 1);
      const size = endOffset - startOffset;
      const baseOffset = startOffset - originOffset;
      const cache = this.#cache[block] || this.#staleCache[block];
      if (cache) {
        const offset = startOffset % blockSize;
        for (let i = 0; i < size; ++i) {
          dst[baseOffset + i] = cache[offset + i];
        }
      } else {
        const src = new Uint8Array(await this.#reader(startOffset, size, true));
        for (let i = 0; i < size; ++i) {
          dst[baseOffset + i] = src[i];
        }
      }
      startOffset += size;
    }
    return dst;
  }

  async write(offset, buffer) {
    const start = offset & ~(blockSize - 1);
    const end = (offset + buffer.byteLength + blockSize - 1) & ~(blockSize - 1);
    const dst = new Uint8Array(end - start);
    const startPaddingSize = offset - start;
    if (startPaddingSize) {
      const src =
        new Uint8Array(await this.#reader(start, startPaddingSize, false));
      for (let i = 0; i < startPaddingSize; ++i) {
        dst[i] = src[i];
      }
    }
    const src = new Uint8Array(buffer);
    for (let i = 0; i < buffer.byteLength; ++i) {
      dst[startPaddingSize + i] = src[i];
    }
    if ((offset + buffer.byteLength) != end) {
      const endPaddingStart = offset + buffer.byteLength;
      const endPaddingSize = end - endPaddingStart;
      if (endPaddingSize) {
        const src = new Uint8Array(
          await this.#reader(endPaddingStart, endPaddingSize, false));
        const endPaddingOffset = endPaddingStart - start;
        for (let i = 0; i < src.byteLength; ++i) {
          dst[endPaddingOffset + i] = src[i];
        }
      }
    }
    const startBlock = (start / blockSize) | 0;
    const endBlock = (end / blockSize) | 0;
    for (let block = startBlock; block < endBlock; ++block) {
      const offset = (block - startBlock) * blockSize;
      this.#cache[block] = dst.slice(offset, offset + blockSize);
    }
  }

  async truncate(size) {
    // Remove cache entries that are in the truncated area.
    const nextBlock = (size / blockSize) | 0;
    for (let key in this.#cache) {
      if (key && (nextBlock <= key)) {
        delete this.#cache[key];
      }
    }
    for (let key in this.#staleCache) {
      if (key && (nextBlock <= key)) {
        delete this.#staleCache[key];
      }
    }
  }

  flush() {
    // Move the active cache to the stale cache, but still the stale cache
    // entries should be reused until the flush is completed.
    this.#staleCache = this.#cache;
    this.#cache = {};
  }

  completeFlush() {
    // Finally the entries in the stale cache can be provided via the underlying
    // API. Release them now.
    this.#staleCache = {};
  }
}

export class NativeIo {
  #handle = null;
  #filesize = 0;
  #file = null;
  #offset = 0;
  #writableStream = null;
  #flushState = 'idle';
  #cache = null;

  constructor() {
    this.#cache = new StoreBuffer(async (offset, size, bypassCache) => {
      if (this.#filesize <= offset) {
        return new ArrayBuffer(0);
      }
      const previousOffset = this.#offset;
      this.#offset = offset;
      const result = await (bypassCache ? this.#read(size) : this.read(size));
      this.#offset = previousOffset;
      return result;
    });
  }

  async getAttributes() {
    await this.#check(false);
    return {
      name: this.#handle.name,
      size: this.#filesize,
      lastModified: new Date(this.#file.lastModified)
    };
  }

  async seek(offset) {
    this.#offset = offset;
  }

  async read(size) {
    if ((this.#offset + size) > this.#filesize) {
      size = this.#filesize - this.#offset;
    }
    if (this.#cache) {
      const result = await this.#cache.read(this.#offset, size);
      this.#offset += result.byteLength;
      return result;
    } else {
      return await this.#read(size);
    }
  }

  async write(buffer) {
    await this.#check(true);
    if (!buffer instanceof ArrayBuffer) {
      throw Error.createInvalidBuffer();
    }
    if (this.#cache) {
      await this.#cache.write(this.#offset, buffer);
    }
    await this.#writableStream.seek(this.#offset);
    await this.#writableStream.write(buffer);
    this.#offset += buffer.byteLength;
    if (this.#offset > this.#filesize) {
      this.#filesize = this.#offset;
    }
  }

  async truncate(size) {
    await this.#check(true);
    if (this.#cache) {
      await this.#cache.truncate(size);
    }
    await this.#writableStream.truncate(size);
    if (this.#offset > size) {
      this.#offset = size;
    }
    this.#filesize = size;
  }

  async flush() {
    if (this.#flushState != 'idle') {
      this.#flushState = 'requested';
      return;
    }
    if (this.#writableStream) {
      this.#flushState = 'running';
      if (this.#cache) {
        this.#cache.flush();
      }
      await this.#writableStream.close();
      this.#writableStream = null;
    }
  }

  async close() {
    this.flush();
    this.#file = null;
    this.#handle = null;
    this.#offset = 0;
  }

  async choose(options) {
    const pickerOptions = {
      multiple: false
    };
    if (options && options.types) {
      pickerOptions.types = options.types;
    }
    this.#handle = (await window.showOpenFilePicker(pickerOptions))[0];
    await this.#check();
  }

  async open(handle) {
    this.#handle = handle;
    await this.#check();
  }

  async #check(writable) {
    if (!this.#handle) {
      throw Error.createNotOpen();
    }
    if (!this.#file) {
      this.#file = await this.#handle.getFile();
      this.#filesize = this.#file.size;
    }
    if (writable && !this.#writableStream) {
      this.#writableStream = await this.#handle.createWritable({
        keepExistingData: true
      });
    }
  }

  async #read(size) {
    await this.#check(false);
    const blob = this.#file.slice(this.#offset, this.#offset + size);
    let buffer = null;;
    try {
      buffer = await blob.arrayBuffer();
    } catch (e) {
      // Once the writable stream is closed, the original file gets
      // unaccessible and needs to reopen it.
      if (e.name != 'NotReadableError') {
        throw e;
      }
      if (this.#cache) {
        this.#cache.completeFlush();
      }
      this.#file = null;
      const result = await this.#read(size);
      const flushState = this.#flushState;
      this.#flushState = 'idle';
      // Another flush may be requested.
      if (flushState == 'requested') {
        await this.flush();
      }
      return result;
    }
    if (buffer.byteLength == 0) {
      return null;
    }
    this.#offset += buffer.byteLength;
    return buffer;
  }
}