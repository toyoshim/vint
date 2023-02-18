// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

const Type = {
  Unknown: -1,
  _2D: 0,
  _2DD: 0x10,
  _2HD: 0x20
};

function getAscii(buffer, offset, size) {
  const end = offset + size;
  const chars = [];
  for (let i = offset; i < end && buffer[i]; ++i) {
    chars.push(String.fromCharCode(buffer[i]));
  }
  return chars.join('');
}

function getShort(buffer, offset) {
  return (buffer[offset + 1] << 8) | buffer[offset];
}

function getLong(buffer, offset) {
  return (getShort(buffer, offset + 2) << 16) | getShort(buffer, offset);
}

class Image {
  #type = Type.Unknown;
  #attributes = {};
  #trackOffsets = [];
  #offset = 0;
  #io = null;

  async open(offset, header, io) {
    this.#type = header[0x1b];
    this.#attributes.name = getAscii(header, 0, 17);
    this.#attributes.readOnly = header[0x1a] == 0x10;
    this.#attributes.size = getLong(header, 0x1c);
    for (let i = 0; i < 164; ++i) {
      const offset = getLong(header, 0x20 + i * 4);
      if (offset == 0) {
        break;
      }
      this.#trackOffsets.push(offset);
    }
    this.#attributes.tracks = this.#trackOffsets.length;
    this.#offset = offset;
    this.#io = io;
    const trackHeader = await this.#read(this.#trackOffsets[0], 0x10);
    this.#attributes.sectorsPerTrack = getShort(trackHeader, 0x04);
    this.#attributes.bytesPerSector = getShort(trackHeader, 0x0e);
  }

  async read(sector) {
    const location = await this.#parseSectorHeader(sector);
    const data =
      await this.#read(location.dataOffset, this.#attributes.bytesPerSector);
    return data.buffer;
  }

  async write(sector, data) {
    const location = await this.#parseSectorHeader(sector);
    if (data.byteLength != this.#attributes.bytesPerSector) {
      throw Error.createInvalidBuffer('D88 wrong size sector write');
    }
    await this.#write(location.dataOffset, data);
  }

  async flush() {
    await this.#io.flush();
  }

  async getAttributes() {
    return this.#attributes;
  }

  async #parseSectorHeader(sector) {
    const location = {};
    location.track = (sector / this.#attributes.sectorsPerTrack) | 0;
    location.sectorInTrack = sector % this.#attributes.sectorsPerTrack;
    location.trackOffset = this.#trackOffsets[location.track];
    if (!location.trackOffset) {
      throw Error.createDiskError('D88 out of range track');
    }
    location.dataOffset = location.trackOffset + 0x10 +
      location.sectorInTrack * this.#attributes.bytesPerSector;

    const trackHeader = await this.#read(location.trackOffset, 0x10);
    const status = trackHeader[0x08];
    if (status) {
      throw Error.createDiskError('D88 error status: ' + status);
    }

    console.assert(
      this.#attributes.sectorsPerTrack == getShort(trackHeader, 0x04));
    console.assert(
      this.#attributes.bytesPerSector == getShort(trackHeader, 0x0e));
    return location;
  }

  async #read(offset, size) {
    await this.#io.seek(this.#offset + offset);
    return new Uint8Array(await this.#io.read(size));
  }

  async #write(offset, data) {
    await this.#io.seek(this.#offset + offset);
    await this.#io.write(data);
  }
}

export class D88Image {
  #images = [];
  #io = null;

  async open(io) {
    if (this.#io) {
      throw Error.createInvalidRequest('already open');
    }
    this.#io = io;
    const attributes = await this.#io.getAttributes();
    let offset = 0;
    while (offset < attributes.size) {
      await this.#io.seek(offset);
      const header = new Uint8Array(await this.#io.read(0x2b0));
      const size = getLong(header, 0x1c);
      const image = new Image();
      await image.open(offset, header, io);
      this.#images.push(image);
      offset += size;
    }
    if (offset != attributes.size) {
      Error.createInvalidFormat('D88 unexpended padding');
    }
  }

  async read(sector) {
    return await this.#images[0].read(sector);
  }

  async write(sector, data) {
    await this.#images[0].write(sector, data);
  }

  async flush() {
    await this.#images[0].flush();
  }

  async getAttributes() {
    const attributes = await this.#images[0].getAttributes();
    attributes.bundles = this.#images.length;
    return attributes;
  }

  async getImage(index) {
    if (this.#images.length <= index) {
      throw Error.createInvalidRequest();
    }
    return this.#images[index];
  }
}