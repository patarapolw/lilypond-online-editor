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
import { isDev } from './shared'

let credentials: any
if (process.env['GCLOUD_JSON']) {
  credentials = JSON.parse(process.env['GCLOUD_JSON'])
}

const bucket = new Storage({
  credentials,
  projectId: 'lilypond-editor',
}).bucket('lilypond')

const tmpdir = path.join(__dirname, '../tmp')

async function main() {
  const port = parseInt(process.env['PORT']!) || 27252

  const existingIds = new Set<string>()

  {
    const [files] = await bucket.getFiles()
    files.map((f) => {
      const parts = f.name.split('/')
      const id = parts[0] || parts[1]!
      if (id[0] !== '.') {
        existingIds.add(id)
      }
    })
  }

  {
    fs.readdirSync(tmpdir).map((f) => {
      const parts = f.split('/')
      const id = parts[0] || parts[1]!
      if (id[0] !== '.') {
        existingIds.add(id)
      }
    })
  }

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
          id: S.string().optional(),
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
              let { id = '' } = req.body
              const { data } = req.body

              if (id.length < 5) {
                id = nanoid(5)
              }

              existingIds.add(id)
              reply.status(201)

              if (!fs.existsSync(path.join(tmpdir, id))) {
                reply.raw.write('Creating directory\n')
                await promisify(fs.mkdir)(path.join(tmpdir, id))
              }

              reply.raw.write('Creating `file.ly`\n')
              await promisify(fs.writeFile)(
                path.join(tmpdir, id, 'file.ly'),
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

              await spawnPipe('lilypond', 'file.ly')

              reply.raw.write(`\nid=${id}\n`)

              if (fs.existsSync(path.join(tmpdir, id, 'file.midi'))) {
                await spawnPipe(
                  'timidity',
                  'file.midi',
                  '-A300',
                  '-Ow',
                  '-o',
                  'file.wav'
                )
              }

              const exts = ['.ly', '.midi', '.pdf', '.wav']
              await Promise.all(
                exts.map(async (ext) => {
                  if (fs.existsSync(path.join(tmpdir, id, 'file' + ext))) {
                    await bucket.upload(path.join(tmpdir, id, 'file' + ext), {
                      destination: `${id}/file${ext}`,
                    })
                    reply.raw.write(`Uploaded ${id}/file${ext}\n`)
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

  app.get<{
    Params: {
      filename: string
    }
  }>('/f/:filename', (req, reply) => {
    const { filename } = req.params
    const p = path.parse(filename)

    if (p.name.length < 5 || !existingIds.has(p.name)) {
      reply.status(404).send()
      return
    }

    if (!p.ext) {
      reply.redirect(302, '/?id=' + encodeURIComponent(p.name))
      return
    }

    if (fs.existsSync(path.join(tmpdir, p.name, 'file' + p.ext))) {
      reply.sendFile('file' + p.ext, path.join(tmpdir, p.name))
      return
    }

    bucket
      .file(`${p.name}/file${p.ext}`)
      .createReadStream()
      .pipe(reply.raw)
      .on('error', () => {
        reply.status(404).send()
      })
  })

  await app.listen(port, '0.0.0.0')
}

if (require.main === module) {
  main()
}
