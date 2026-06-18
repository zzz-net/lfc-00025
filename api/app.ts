/**
 * This is a API server
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import authRoutes from './routes/auth.js'
import sensorRoutes from './routes/sensors.js'
import importRoutes from './routes/import.js'
import anomalyRoutes from './routes/anomalies.js'
import annotationRoutes from './routes/annotations.js'
import reportRoutes from './routes/report.js'
import stateRoutes from './routes/state.js'
import auditRoutes from './routes/audit.js'
import workOrderRoutes from './routes/workorders.js'
import sandboxRoutes from './routes/sandbox.js'

// for esm mode
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// load env
dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '..', 'dist')
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath))
    app.get(/^\/(?!api).*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'))
    })
  }
}

/**
 * API Routes
 */
app.use('/api/auth', authRoutes)
app.use('/api/sensors', sensorRoutes)
app.use('/api/import', importRoutes)
app.use('/api/anomalies', anomalyRoutes)
app.use('/api/annotations', annotationRoutes)
app.use('/api/report', reportRoutes)
app.use('/api/state', stateRoutes)
app.use('/api/audit', auditRoutes)
app.use('/api/workorders', workOrderRoutes)
app.use('/api/sandbox', sandboxRoutes)

/**
 * health
 */
app.use(
  '/api/health',
  (req: Request, res: Response, _next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

/**
 * error handler middleware
 */
app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('[API Error]', req.method, req.path, error.message, error.stack);
  res.status(500).json({
    success: false,
    error: error.message || 'Server internal error',
  });
});

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
