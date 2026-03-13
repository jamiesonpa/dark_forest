import { createServer } from 'http'
import express from 'express'
import colyseus from 'colyseus'
import { StarSystemRoom } from './rooms/StarSystemRoom.js'

const { Server } = colyseus

const port = Number(process.env.PORT ?? 2567)
const host = process.env.HOST ?? '0.0.0.0'
const app = express()
app.use(express.json())
const httpServer = createServer(app)

const gameServer = new Server({
  server: httpServer,
})

gameServer.define('star_system', StarSystemRoom)

httpServer.listen(port, host, () => {
  console.log(`Colyseus server listening on ${host}:${port}`)
})
