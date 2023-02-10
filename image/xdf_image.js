// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

export class XdfImage {
  #io = null;

  async open(io) {
    if (this.#io) {
      throw Error.createInvalidRequest();
    }
    const attributes = await io.getAttributes();
    if (attributes.size != 1261568) {
      throw Error.createInvalidFormat();
    }
    this.#io = io;
  }

  async read(sector) {
    if (!this.#io) {
      throw Error.createNotOpen();
    }
    const sectorSize = 1024;
    await this.#io.seek(sector * sectorSize);
    return await this.#io.read(sectorSize);
  }

  async getAttributes() {
    return {
      bytesPerSector: 1024,
      sectorsPerTrack: 8,
      tracks: 154
    };
  }
}