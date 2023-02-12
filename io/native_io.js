// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

class StoreBuffer {
  #cache = {};
  #reader = null;

  constructor(reader) {
    this.#reader = reader;
  }

  async read(offset, size) {
    return await this.#reader(offset, size);
  }

  async write(offset, buffer) {
  }

  async truncate(size) {
  }

  async flush() {
  }
}

export class NativeIo {
  #handle = null;
  #filesize = 0;
  #file = null;
  #offset = 0;
  #writableStream = null;
  #cache = null;

  constructor() {
    this.#cache = new StoreBuffer(async (offset, size) => {
      const previousOffset = this.#offset;
      this.#offset = offset;
      const result = await this.#read(size);
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
      return await this.#cache.read(this.#offset, size);
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
    if (this.#writableStream) {
      await this.#writableStream.close();
      this.#writableStream = null;
      if (this.#cache) {
        await this.#cache.flush();
      }
    }
  }

  async close() {
    this.flush();
    this.#file = null;
    this.#handle = null;
    this.#offset = 0;
  }

  async choose() {
    this.#handle = (await window.showOpenFilePicker({
      multiple: false
    }))[0];
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
    // TODO: revalidation.
    await this.#check(false);
    const blob = this.#file.slice(this.#offset, this.#offset + size);
    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength == 0) {
      return null;
    }
    this.#offset += buffer.byteLength;
    return buffer;
  }
}