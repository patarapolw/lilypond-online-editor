import { spawn } from 'child_process'
import fs, { WriteStream } from 'fs'
import path from 'path'
import { promisify } from 'util'

import { mongoose } from '@typegoose/typegoose'
import fastify from 'fastify'
import fastifyHelmet from 'fastify-helmet'
import fastifyRateLimit from 'fastify-rate-limit'
import fastifyStatic from 'fastify-static'
import S from 'jsonschema-definer'
import { GridFSBucket, ObjectId } from 'mongodb'

import { DbEntryModel } from './db'
import { gCloudLogger } from './logger'
import { isDev, tmpdir } from './shared'

async function main() {
  const port = parseInt(process.env['PORT']!) || 27252

  await mongoose.connect(process.env['MONGO_URI']!)
  const bucket = new GridFSBucket(mongoose.connection.db)

  const app = fastify({
    logger: gCloudLogger({
      prettyPrint: isDev,
    }),
  })

  if (isDev) {
    app.register(require('fastify-cors'))
  }

  app.register(fastifyHelmet)

  app.register(
    async (f) => {
      f.register(fastifyRateLimit, {
        max: 1,
        timeWindow: '1 second',
      })

      {
        const sBody = S.shape({
          id: S.string(),
          data: S.string(),
        })

        f.post<{
          Body: typeof sBody.type
        }>(
          '/save',
          {
            schema: {
              body: sBody.valueOf(),
            },
          },
          (req, reply) => {
            ;(async () => {
              let { id } = req.body
              const { data } = req.body

              id = id.split('/')[0]!

              let prev:
                | {
                    uid: string
                    version: number
                    lilypond: string
                  }
                | undefined

              if (id.length < 5) {
                id = await DbEntryModel.newUID()
              } else {
                const p = await DbEntryModel.findOne({ uid: id }).sort({
                  createdAt: -1,
                })
                if (p) {
                  prev = p
                } else {
                  id = await DbEntryModel.newUID()
                }
              }

              if (prev?.lilypond === data) {
                reply.status(200).send()
                return
              }

              const ver = (prev?.version || 0) + 1
              reply.status(201)

              if (!fs.existsSync(path.join(tmpdir, id))) {
                reply.raw.write('Creating directory\n')
                await promisify(fs.mkdir)(path.join(tmpdir, id))
              }

              reply.raw.write(`Creating ${id}/${ver}.ly\n`)
              await promisify(fs.writeFile)(
                path.join(tmpdir, `${id}/${ver}.ly`),
                data
              )

              const spawnPipe = async (...cmd: string[]) => {
                const p = spawn(cmd[0]!, cmd.slice(1), {
                  cwd: path.join(tmpdir, id),
                })

                p.stdout.on('data', (data) => reply.raw.write(data))
                p.stderr.on('data', (data) => reply.raw.write(data))

                await new Promise<void>((resolve, reject) => {
                  p.once('close', () => resolve())
                  p.once('error', reject)
                })
              }

              await spawnPipe('lilypond', `${ver}.ly`)

              if (fs.existsSync(path.join(tmpdir, id, `${ver}.midi`))) {
                await spawnPipe(
                  'timidity',
                  `${ver}.midi`,
                  '-A300',
                  '-Ow',
                  '-o',
                  `${ver}.wav`
                )
              }

              reply.raw.write(`id=${id}/${ver}\n`)

              const files: Record<
                'midi' | 'pdf' | 'wav',
                ObjectId | undefined
              > = {
                midi: undefined,
                pdf: undefined,
                wav: undefined,
              }

              await Promise.all(
                Object.keys(files).map(async (ext) => {
                  if (fs.existsSync(path.join(tmpdir, `${id}/${ver}.${ext}`))) {
                    await new Promise<void>((resolve, reject) => {
                      const s = bucket.openUploadStream(`${id}/${ver}.${ext}`)

                      fs.createReadStream(
                        path.join(tmpdir, `${id}/${ver}.${ext}`)
                      )
                        .pipe(s as unknown as WriteStream)
                        .once('error', reject)
                        .once('close', () => {
                          files[ext as keyof typeof files] = s.id
                          resolve()
                        })
                    })

                    reply.raw.write(`Uploaded ${id}/${ver}.${ext}\n`)
                  }
                })
              )

              await DbEntryModel.create({
                ...files,
                uid: id,
                version: ver,
                lilypond: data,
              })

              reply.raw.end()
            })()
          }
        )
      }
    },
    {
      prefix: '/api',
    }
  )

  app.register(fastifyStatic, {
    root: path.join(__dirname, '../public'),
    redirect: true,
  })

  app.register(fastifyStatic, {
    root: path.join(__dirname, '../pdf.js-dist'),
    prefix: '/pdf.js',
    decorateReply: false,
  })

  app.get<{
    Params: {
      filename: string
    }
  }>('/f/:filename', (req, reply) => {
    ;(async () => {
      const { filename } = req.params
      const p = path.parse(filename)

      const ext = p.ext
      const uid = p.base

      if (uid.length < 5) {
        reply.status(404).send()
        return
      }

      if (!ext) {
        reply.redirect(302, '/?id=' + encodeURIComponent(uid))
        return
      }

      const prev = await DbEntryModel.findOne({
        uid,
      }).sort({
        createdAt: -1,
      })
      if (!prev) {
        reply.status(404).send()
        return
      }

      if (
        fs.existsSync(path.join(tmpdir, uid, prev.version.toString() + ext))
      ) {
        reply.sendFile(prev.version.toString() + ext, path.join(tmpdir, uid))
        return
      }

      if (ext === '.ly') {
        reply.send(prev.lilypond)
        return
      }

      const oid = (prev as any)[ext.substr(1)]

      if (!oid) {
        reply.status(404).send()
        return
      }

      bucket
        .openDownloadStream(oid)
        .pipe(reply.raw)
        .on('error', () => {
          reply.status(404).send()
        })
    })()
  })

  app.get<{
    Params: {
      filename: string
      ver: string
    }
  }>('/f/:filename/:ver', (req, reply) => {
    ;(async () => {
      const { filename, ver: _ver } = req.params

      const ext = path.parse(_ver).ext
      const uid = filename
      const version = parseInt(_ver.split('.')[0]!)

      if (uid.length < 5 || !version) {
        reply.status(404).send()
        return
      }

      if (!ext) {
        reply.redirect(302, '/?id=' + encodeURIComponent(uid) + '/' + version)
        return
      }

      const prev = await DbEntryModel.findOne({
        uid,
        version,
      })

      if (!prev) {
        if (fs.existsSync(path.join(tmpdir, uid))) {
          const [f] = await promisify(fs.readdir)(path.join(tmpdir, uid)).then(
            (files) =>
              files
                .filter((f) => f.endsWith(ext))
                .sort()
                .reverse()
          )
          if (f) {
            reply.sendFile(f, path.join(tmpdir, uid))
          } else {
            reply.status(404).send()
          }

          return
        } else {
          reply.status(404).send()
          return
        }
      }

      if (
        fs.existsSync(path.join(tmpdir, uid, prev.version.toString() + ext))
      ) {
        reply.sendFile(prev.version.toString() + ext, path.join(tmpdir, uid))
        return
      }

      if (ext === '.ly') {
        reply.send(prev.lilypond)
        return
      }

      const oid = (prev as any)[ext.substr(1)]

      if (!oid) {
        reply.status(404).send()
        return
      }

      bucket
        .openDownloadStream(oid)
        .pipe(reply.raw)
        .on('error', () => {
          reply.status(404).send()
        })
    })()
  })

  await app.listen(port, '0.0.0.0')
}

if (require.main === module) {
  main()
}
