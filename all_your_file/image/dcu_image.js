// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

const Type = {
  _2HD_8Sector: 0,    // 1.25M: 1024 *  8 * 77 * 2
  _2HC_15Sector: 1,   // 1.21M:  512 * 15 * 80 * 2
  _2HCE_18Sector: 2,  // 1.44M:  512 * 18 * 80 * 2
  _2DD_8Sector: 3,    // 640KB:  512 *  8 * 80 * 2
  _2DD_9Sector: 4,    // 720KB:  512 *  9 * 80 * 2
  _Unknown: -1
};
const Track = {
  Unused: 0,
  Used: 1,
  Stopped: 1,
  Bad: 255
};

function getAttributes(type) {
  if (Type._2HD_8Sector == type) {
    return {
      bytesPerSector: 1024,
      sectorsPerTrack: 8,
      tracks: 154
    };
  } else if (Type._2HC_15Sector == type) {
    return {
      bytesPerSector: 512,
      sectorsPerTrack: 15,
      tracks: 160
    };
  } else if (Type._2HCE_18Sector == type) {
    return {
      bytesPerSector: 512,
      sectorsPerTrack: 18,
      tracks: 160
    };
  } else if (Type._2DD_8Sector == type) {
    return {
      bytesPerSector: 512,
      sectorsPerTrack: 8,
      tracks: 160
    };
  } else if (Type._2DD_8Sector == type) {
    return {
      bytesPerSector: 512,
      sectorsPerTrack: 9,
      tracks: 160
    };
  }
  throw Error.createInvalidFormat('DCU unknown type');
}

export class DcuImage {
  #io = null;
  #type = Type._Unknown;
  #attributes = {};
  #tracks = [];
  #trackOffsets = [];

  async open(io) {
    if (this.#io) {
      throw Error.createInvalidRequest('already open');
    }
    const header = new Uint8Array(await io.read(162));
    this.#type = header[0];
    this.#attributes = getAttributes(this.#type);
    this.#tracks = header.subarray(1, 161);
    const headerSize = 162;
    while (!this.#checkHeader(header)) {
      if (this.#type != 0) {
        console.log('DCU: assuming the wrong media type');
        this.#type = 0;
        this.#attributes = getAttributes(this.#type);
        continue;
      }
      throw Error.createInvalidFormat('DCU invalid track information');
    }
    const sizePerTrack =
      this.#attributes.bytesPerSector * this.#attributes.sectorsPerTrack;
    let validTracks = 0;
    let offset = headerSize;
    for (let i = 0; i < this.#attributes.tracks; ++i) {
      this.#trackOffsets[i] = offset;
      if (this.#tracks[i] == Track.Used) {
        validTracks++;
        offset += sizePerTrack;
      }
    }
    const attributes = await io.getAttributes();
    if (attributes.size != (162 + sizePerTrack * validTracks)) {
      throw Error.createInvalidFormat('DCU invalid filesize');
    }
    this.#attributes.name = attributes.name;
    this.#io = io;
  }

  async read(sector) {
    this.#check();
    await this.#io.seek(this.#getTrackOffset(sector));
    return await this.#io.read(this.#attributes.bytesPerSector);
  }

  async write(sector, data) {
    this.#check();
    await this.#io.seek(this.#getTrackOffset(sector));
    if (data.byteLength != this.#attributes.bytesPerSector) {
      throw Error.createInvalidBuffer('wrong sector size');
    }
    return await this.#io.write(data);
  }

  async flush() {
    this.#check();
    await this.#io.flush();
  }

  async getAttributes() {
    this.#check();
    return this.#attributes;
  }

  #check() {
    if (!this.#io) {
      throw Error.createNotOpen('DCU');
    }
  }

  #getTrackOffset(sector) {
    const track = (sector / this.#attributes.sectorsPerTrack) | 0;
    if (this.#tracks[track] == Track.Bad) {
      throw Error.createDiskError();
    }
    const sectorInTrack = sector % this.#attributes.sectorsPerTrack;
    const offsetInTrack = sectorInTrack * this.#attributes.bytesPerSector;
    return this.#trackOffsets[track] + offsetInTrack;
  }

  #checkHeader(header) {
    if (header[this.#attributes.tracks + 1] != Track.Stopped) {
      return false;
    }
    if (this.#attributes.tracks != 160 && header[161] != Track.Unused) {
      return false;
    }
    return true;
  }
}