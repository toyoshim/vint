// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

const sectorSize = 1024;
const sectorCount = 1232;

export class XdfImage {
  #io = null;
  #name = '';

  async open(io) {
    if (this.#io) {
      throw Error.createInvalidRequest();
    }
    const attributes = await io.getAttributes();
    if (attributes.size != 1261568) {
      throw Error.createInvalidFormat();
    }
    this.#name = attributes.name;
    this.#io = io;
  }

  async read(sector) {
    if (!this.#io) {
      throw Error.createNotOpen();
    }
    if (sector >= sectorCount) {
      throw Error.createNoSpace('invalid sector');
    }
    await this.#io.seek(sector * sectorSize);
    return await this.#io.read(sectorSize);
  }

  async write(sector, data) {
    if (!this.#io) {
      throw Error.createNotOpen();
    }
    if (sector >= sectorCount) {
      throw Error.createNoSpace('invalid sector');
    }
    await this.#io.seek(sector * sectorSize);
    return await this.#io.write(data);
  }

  async flush() {
    if (!this.#io) {
      return;
    }
    await this.#io.flush();
  }

  async getAttributes() {
    return {
      bytesPerSector: 1024,
      sectorsPerTrack: 8,
      tracks: 154,
      name: this.#name
    };
  }
}