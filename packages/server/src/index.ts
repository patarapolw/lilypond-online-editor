import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'

import { Storage } from '@google-cloud/storage'
import fastify from 'fastify'
import fastifyHelmet from 'fastify-helmet'
import fastifyRateLimit from 'fastify-rate-limit'
import fastifyStatic from 'fastify-static'
import S from 'jsonschema-definer'
import { nanoid } from 'nanoid'

import { gCloudLogger } from './logger'
import { isDev, tmpdir } from './shared'

const bucket = new Storage({
  credentials: JSON.parse(process.env['GCLOUD_JSON']!),
  projectId: 'lilypond-editor',
}).bucket('lilypond')

async function main() {
  const port = parseInt(process.env['PORT']!) || 27252

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

              const existing = await getExistingFilenames()
              const existingIds = new Set(
                existing.map((it) => it.split('/')[0]!)
              )
              const newID = () => {
                let id = nanoid(5)
                while (existingIds.has(id)) {
                  id = nanoid(5)
                }

                return id
              }

              let version = 0

              if (id.length >= 5) {
                const [p] = existing.filter((it) => it.startsWith(id + '/'))
                if (p) {
                  const ps = p.split('/')
                  if (ps[1]) {
                    version = parseInt(ps[1])
                    id = ps[0]!
                  }
                }
              }

              if (!version) {
                id = newID()
                version = 0
              } else {
                const [r] = await bucket.file(`${id}/${version}.ly`).download()

                if (r.toString('utf-8') === data) {
                  reply.status(200).send()
                  return
                }
              }

              version++
              reply.status(201)

              if (!fs.existsSync(path.join(tmpdir, id))) {
                reply.raw.write('Creating directory\n')
                await promisify(fs.mkdir)(path.join(tmpdir, id))
              }

              reply.raw.write(`Creating ${id}/${version}.ly\n`)
              await promisify(fs.writeFile)(
                path.join(tmpdir, `${id}/${version}.ly`),
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

              await spawnPipe('lilypond', `${version}.ly`)

              if (fs.existsSync(path.join(tmpdir, id, `${version}.midi`))) {
                await spawnPipe(
                  'timidity',
                  `${version}.midi`,
                  '-A300',
                  '-Ow',
                  '-o',
                  `${version}.wav`
                )
              }

              reply.raw.write(`id=${id}/${version}\n`)

              await Promise.all(
                ['ly', 'midi', 'pdf', 'wav'].map(async (ext) => {
                  if (
                    fs.existsSync(path.join(tmpdir, `${id}/${version}.${ext}`))
                  ) {
                    await bucket.upload(
                      path.join(tmpdir, `${id}/${version}.${ext}`),
                      {
                        destination: `${id}/${version}.${ext}`,
                      }
                    )

                    reply.raw.write(`Uploaded ${id}/${version}.${ext}\n`)
                  }
                })
              )

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
      const uid = p.name

      if (uid.length < 5) {
        reply.status(404).send()
        return
      }

      if (!ext) {
        reply.redirect(302, '/?id=' + encodeURIComponent(uid))
        return
      }

      const existing = await getExistingFilenames()
      const [prev] = existing.filter((it) => it.startsWith(uid + '/'))
      if (!prev) {
        reply.status(404).send()
        return
      }

      if (fs.existsSync(path.join(tmpdir, prev + ext))) {
        reply.sendFile(
          prev.substr(uid.length + 1) + ext,
          path.join(tmpdir, uid)
        )
        return
      }

      bucket
        .file(prev + ext)
        .createReadStream()
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

      if (uid.length < 5) {
        reply.status(404).send()
        return
      }

      if (!version) {
        reply.redirect(301, '/f/' + uid + ext)
        return
      }

      if (!ext) {
        reply.redirect(302, '/?id=' + uid + '/' + version)
        return
      }

      const existing = await getExistingFilenames()
      const [prev] = existing.filter((it) => it.startsWith(uid + '/' + version))
      if (!prev) {
        reply.status(404).send()
        return
      }

      if (fs.existsSync(path.join(tmpdir, prev + ext))) {
        reply.sendFile(
          prev.substr(uid.length + 1) + ext,
          path.join(tmpdir, uid)
        )
        return
      }

      bucket
        .file(prev + ext)
        .createReadStream()
        .pipe(reply.raw)
        .on('error', () => {
          reply.status(404).send()
        })
    })()
  })

  await app.listen(port, '0.0.0.0')
}

async function getExistingFilenames() {
  const existingFilenames = new Set<string>()

  const addFilenames = (f: string) => {
    f = f.replace(/^\//, '').replace(/\.[^/]+$/, '')
    if (f[0] !== '.') {
      existingFilenames.add(f)
    }
  }

  {
    const [files] = await bucket.getFiles()
    files.map((f) => {
      addFilenames(f.name)
    })
  }

  {
    fs.readdirSync(tmpdir).map((f) => {
      addFilenames(f)
    })
  }

  return [...existingFilenames].sort((a, b) => {
    const f = (a: string) => parseInt(a.split('/')[1]!)
    return f(b) - f(a)
  })
}

if (require.main === module) {
  main()
}
