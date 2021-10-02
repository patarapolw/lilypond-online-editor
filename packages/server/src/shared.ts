import path from 'path'

export const isDev = process.env['NODE_ENV'] === 'development'
export const tmpdir = path.join(__dirname, '../tmp')
