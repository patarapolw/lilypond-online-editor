import fs from 'fs'

import { getModelForClass, index, prop } from '@typegoose/typegoose'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

import { tmpdir } from './shared'

@index({ uid: 1, version: 1 }, { unique: true })
class DbEntry {
  @prop({ index: true, required: true }) uid!: string
  @prop({ default: 1 }) version!: number
  @prop({ index: 'text', required: true }) lilypond!: string
  @prop() midi?: ObjectId
  @prop() pdf?: ObjectId
  @prop() wav?: ObjectId

  static async uids(): Promise<Set<string>> {
    const ids: string[] = await DbEntryModel.aggregate<{
      _id: string
    }>([{ $group: { _id: '$uid' } }]).then((rs) => rs.map((r) => r._id))

    fs.readdirSync(tmpdir).map((f) => {
      const parts = f.split('/')
      const id = parts[0] || parts[1]!
      if (id[0] !== '.') {
        ids.push(id)
      }
    })

    return new Set(ids)
  }

  static async newUID(): Promise<string> {
    const ids = await DbEntryModel.uids()

    let id = nanoid(5)
    while (ids.has(id)) {
      id = nanoid(5)
    }

    return id
  }
}

export const DbEntryModel = getModelForClass(DbEntry, {
  schemaOptions: { timestamps: { createdAt: true }, collection: 'Entry' },
})
