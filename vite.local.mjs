// Lokalne narzędzia serwera deweloperskiego (nie w repozytorium): zapis próbek głosu i log diagnostyczny.
import fs from 'node:fs'
import path from 'node:path'

/**
 * Zapis próbek głosu z ukrytego okna „Próbki głosu” (kalibracja oceny powietrza).
 * Działa wyłącznie w serwerze deweloperskim (npm run dev) – w wersji produkcyjnej tych adresów nie ma.
 *   GET  /__samples/list          – lista nagrań (zawartość plików .json)
 *   GET  /__samples/file/<nazwa>  – plik .wav lub .json
 *   PUT  /__samples/file/<nazwa>  – zapis (nadpisanie) pliku .wav lub .json
 * Pliki trafiają do folderu audio-breathiness w katalogu projektu.
 */
function samplesPlugin() {
  return {
    name: 'slowik-samples',
    apply: 'serve',
    configureServer(server) {
      const dir = path.resolve(server.config.root, 'audio-breathiness')
      const safe = (n) => /^[A-Za-z0-9_-]+\.(wav|json)$/.test(n)
      server.middlewares.use('/__samples', (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const send = (code, body, type = 'text/plain; charset=utf-8') => {
          res.statusCode = code
          res.setHeader('Content-Type', type)
          res.end(body)
        }
        try {
          if (req.method === 'GET' && url.pathname === '/list') {
            const list = fs.existsSync(dir)
              ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
              : []
            send(200, JSON.stringify(list), 'application/json; charset=utf-8')
            return
          }
          const m = /^\/file\/([^/]+)$/.exec(url.pathname)
          if (!m) { next(); return }
          const name = decodeURIComponent(m[1] ?? '')
          if (!safe(name)) { send(400, 'Niedozwolona nazwa pliku'); return }
          const file = path.join(dir, name)
          if (req.method === 'GET') {
            if (!fs.existsSync(file)) { send(404, 'Brak pliku'); return }
            res.statusCode = 200
            res.setHeader('Content-Type', name.endsWith('.wav') ? 'audio/wav' : 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            fs.createReadStream(file).pipe(res)
            return
          }
          if (req.method === 'PUT') {
            const chunks = []
            req.on('data', (c) => chunks.push(c))
            req.on('end', () => {
              try {
                fs.mkdirSync(dir, { recursive: true })
                fs.writeFileSync(file, Buffer.concat(chunks))
                send(200, 'ok')
              } catch (e) {
                send(500, String(e))
              }
            })
            return
          }
          send(405, 'Metoda niedozwolona')
        } catch (e) {
          send(500, String(e))
        }
      })
    }
  }
}

/** Diagnostyka dźwięku: POST /__log dopisuje linię do debug-audio.log (tylko serwer deweloperski). */
function audioLogPlugin() {
  return {
    name: 'slowik-audio-log',
    apply: 'serve',
    configureServer(server) {
      const file = path.resolve(server.config.root, 'debug-audio.log')
      server.middlewares.use('/__log', (req, res) => {
        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          try { fs.appendFileSync(file, Buffer.concat(chunks).toString('utf8').slice(0, 2000) + '\n') } catch { /* nic */ }
          res.statusCode = 204
          res.end()
        })
      })
    }
  }
}

export default [samplesPlugin(), audioLogPlugin()]
