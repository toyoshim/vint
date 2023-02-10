// Copyright 2023 Takashi Toyoshima <toyoshim@gmail.com>.
// Use of this source code is governed by a BSD-style license that can be found
// in the LICENSE file.

import { Error } from "../error.js"

function getAscii(buffer, offset, size) {
  const end = offset + size;
  const chars = [];
  for (let i = offset; i < end; ++i) {
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

function getEntryName(buffer, index) {
  const offset = index * 32;
  const chars = [];
  for (let i = 0; i < 8; ++i) {
    if (buffer[offset + i] == 0x20) {
      break;
    }
    chars.push(buffer[offset + i]);
  }
  // Human68k extension.
  for (let i = 12; i < 21; ++i) {
    if (buffer[offset + i] == 0) {
      break;
    }
    chars.push(buffer[offset + i]);
  }
  for (let i = 8; i < 11; ++i) {
    if (buffer[offset + i] == 0x20) {
      break;
    }
    if (i == 8) {
      chars.push('.'.charCodeAt(0));
    }
    chars.push(buffer[offset + i]);
  }
  return chars;
}

function getTimestamp(date, time, subtime) {
  const year = 1980 + (date >> 9);
  const month = (date >> 5) & 15;
  const day = date & 31;
  const hour = time ? ((time >> 11) & 31) : 0;
  const minute = time ? ((time >> 5) & 63) : 0;
  let second = time ? ((time & 31) * 2) : 0;
  if (subtime) {
    second += subtime / 100;
  }
  let msec = second;
  second |= 0;
  msec = ((msec - second) * 1000) | 0;
  const timestamp = new Date();
  timestamp.setFullYear(year);
  timestamp.setMonth((month || 1) - 1);
  timestamp.setDate(day || 1);
  timestamp.setHours(hour);
  timestamp.setMinutes(minute);
  timestamp.setSeconds(second, msec);
  return timestamp;
}

function countBlock(n, block) {
  return ((n + block - 1) / block) | 0;
}

export class FatFs {
  #image = null;
  #oemName = '';
  #bytesPerSector = 0;
  #sectorPerCluster = 0;
  #reservedSectorCount = 0;
  #fatCount = 0;
  #rootEntryCount = 0;
  #totalSectors = 0;
  #mediaType = 0;
  #fatSectors = 0;
  #sectorsPerTrack = 0;
  #headCount = 0;
  #hiddenSectors = 0;
  #volumeId = 0;
  #volumeLabel = '';
  #fatTypeString = '';
  #fatStartSector = 0;
  #rootDirectoryStartSector = 0;
  #rootDirectorySectors = 0;
  #dataStartSector = 0;
  #dataSectors = 0;
  #fatType = 0;
  #fat = null;
  #currentDirectoryStartSector = 0;
  #currentDirectorySectors = 0;

  async open(image) {
    if (this.#image) {
      throw Error.createInvalidRequest();
    }
    const attributes = await image.getAttributes();
    const bootSector = new Uint8Array(await image.read(0));
    this.#oemName = getAscii(bootSector, 3, 8);
    this.#bytesPerSector = getShort(bootSector, 11);
    this.#sectorPerCluster = bootSector[13];
    this.#reservedSectorCount = getShort(bootSector, 14);
    this.#fatCount = bootSector[16];
    this.#rootEntryCount = getShort(bootSector, 17);
    this.#totalSectors = getShort(bootSector, 19);
    this.#mediaType = bootSector[21];
    this.#fatSectors = getShort(bootSector, 22);
    this.#sectorsPerTrack = getShort(bootSector, 24);
    this.#headCount = getShort(bootSector, 26);
    this.#hiddenSectors = getLong(bootSector, 28);
    if (this.#totalSectors == 0) {
      this.#totalSectors = getLong(bootSector, 32);
    }
    if (bootSector[38] == 0x29) {
      this.#volumeId = getLong(bootSector, 39);
      this.#volumeLabel = getAscii(bootSector, 43, 11);
      this.#fatTypeString = getAscii(bootSector, 54, 8);
    }
    if (this.#bytesPerSector != attributes.bytesPerSector) {
      throw Error.createInvalidFormat('inconsistent sector size');
    }
    if (this.#sectorsPerTrack != attributes.sectorsPerTrack) {
      throw Error.createInvalidFormat('inconsistent sectors/track');
    }
    if (this.#totalSectors != attributes.sectorsPerTrack * attributes.tracks) {
      throw Error.createInvalidFormat('inconsistent total tracks');
    }

    this.#fatStartSector = this.#reservedSectorCount;
    this.#rootDirectoryStartSector =
      this.#fatStartSector + this.#fatSectors * this.#fatCount;
    this.#rootDirectorySectors =
      countBlock(32 * this.#rootEntryCount, this.#bytesPerSector);
    this.#dataStartSector =
      this.#rootDirectoryStartSector + this.#rootDirectorySectors;
    this.#dataSectors = this.#totalSectors - this.#dataSectors;

    const clusters = (this.#dataSectors / this.#sectorPerCluster) | 0;
    if (clusters < 4086) {
      this.#fatType = 12;
    } else if (clusters < 65526) {
      this.#fatType = 16;
    } else {
      this.#fatType = 32;
    }
    if (this.#fatType != 12) {
      throw Error.createInvalidFormat('fat16/fat32 are not supported');
    }
    this.#image = image;
    this.#fat = await this.#readSectors(this.#fatStartSector, this.#fatSectors);
    await this.#list(entry => {
      if (!entry.volume) {
        return;
      }
      this.#volumeLabel = entry.name;
    }, true);
  }

  async list(observer) {
    await this.#list(observer, true);
  }

  async chdir(name) {
    await this.#list(async entry => {
      if (!entry.directory || entry.name != name) {
        return;
      }
      if (entry.cluster == 0) {
        this.#currentDirectoryStartSector = 0;
        this.#currentDirectorySectors = 0;
        return;
      }
      let size = 0;
      for (let cluster = entry.cluster; cluster != 0xfff; size++) {
        cluster = await this.#getFat(cluster);
        if (!cluster) {
          throw Error.createInvalidFormat('invalid directory entry');
        }
      }
      this.#currentDirectoryStartSector =
        this.#dataStartSector + (entry.cluster - 2) * this.#sectorPerCluster;
      this.#currentDirectorySectors = size * this.#sectorPerCluster;
    }, true);
  }

  // mkdir

  // getIo

  async getAttributes() {
    return {
      encoding: 'Shift_JIS',
      volumeLevel: this.#volumeLabel
    };
  }

  async #list(observer, showPrivate) {
    const startSector =
      this.#currentDirectoryStartSector || this.#rootDirectoryStartSector;
    const sectors =
      this.#currentDirectorySectors || this.#rootDirectorySectors;
    const entry = await this.#readSectors(startSector, sectors);
    for (let index = 0; index < this.#rootEntryCount; ++index) {
      const firstEntry = entry[32 * index];
      if (firstEntry == 0xe5) {
        // Deleted entry.
        continue;
      } else if (firstEntry == 0) {
        // No more entry.
        break;
      }
      const name = getEntryName(entry, index);
      const attributes = entry[32 * index + 11];
      if ((attributes & 0x08) && !showPrivate) {
        // Volume entry is private.
        continue;
      }
      const created = getTimestamp(
        getShort(entry, 32 * index + 16),
        getShort(entry, 32 * index + 14),
        entry[32 * index + 13]
      );
      const accessed = getTimestamp(getShort(entry, 32 * index + 18));
      const modified = getTimestamp(
        getShort(entry, 32 * index + 24),
        getShort(entry, 32 * index + 22)
      );
      const data = {
        name: name,
        writable: (attributes & 0x01) == 0,
        readable: (attributes & 0x02) == 0,
        system: (attributes & 0x04) != 0,
        volume: (attributes & 0x08) != 0,
        directory: (attributes & 0x10) != 0,
        archive: (attributes & 0x20) != 0,
        created: created,
        accessed: accessed,
        modified: modified,
        size: getLong(entry, 32 * index + 28)
      };
      if (window.Encoding) {
        data.nameArray = data.name;
        const unicodeArray = Encoding.convert(data.name, {
          to: 'UNICODE',
          from: 'SJIS'
        });
        data.name = Encoding.codeToString(unicodeArray);
        data.rawName = data.nameArray.join('');
      } else {
        data.name = data.name.join('');
      }
      if (showPrivate) {
        const clusterHigh = getShort(entry, 32 * index + 20);
        const clusterLow = getShort(entry, 32 * index + 26);
        data.cluster = (clusterHigh << 16) | clusterLow;
      }
      observer(data);
    }
  }

  async #readSectors(sector, count) {
    const buffer = new ArrayBuffer(this.#bytesPerSector * count);
    const dst = new Uint8Array(buffer);
    for (let i = 0; i < count; ++i) {
      const src = new Uint8Array(await this.#image.read(sector + i));
      const offset = this.#bytesPerSector * i;
      for (let j = 0; j < this.#bytesPerSector; ++j) {
        dst[offset + j] = src[j];
      }
    }
    return dst;
  }

  async #getFat(cluster) {
    if (cluster & 1) {
      const offset = (cluster * 1.5) | 0;
      return (this.#fat[offset + 1] << 4) | (this.#fat[offset] >> 4);
    } else {
      const offset = (cluster * 1.5) | 0;
      return ((this.#fat[offset + 1] & 0x0f) << 8) | this.#fat[offset];
    }
  }
}