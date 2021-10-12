import { App, Context, Modules } from '@koishijs/core'
import { defineProperty, remove, Schema } from '@koishijs/utils'
import { Server, createServer } from 'http'
import { Requester } from './http'
import { Cache } from './cache'
import { Assets } from './assets'
import Router from '@koa/router'
import type Koa from 'koa'

export * from './adapter'
export * from './http'

export * from '@koishijs/core'
export * from '@koishijs/utils'

declare module 'koa' {
  // koa-bodyparser
  interface Request {
    body?: any
    rawBody?: string
  }
}

declare module '@koishijs/core' {
  interface App {
    _httpServer?: Server
  }

  namespace App {
    interface Config {
      baseDir?: string
    }

    namespace Config {
      interface Network {
        port?: number
        host?: string
      }
    }
  }

  namespace Context {
    interface Services {
      assets: Assets
      cache: Cache
      http: Requester
      router: Router
    }
  }
}

App.Config.Network.dict = {
  host: Schema.string('要监听的 IP 地址。如果将此设置为 `0.0.0.0` 将监听所有地址，包括局域网和公网地址。'),
  port: Schema.number('要监听的端口。'),
  ...App.Config.Network.dict,
}

// use node require
Modules.internal.require = require
Modules.internal.resolve = require.resolve

Context.service('assets')
Context.service('cache')
Context.service('http')
Context.service('router')

const prepare = App.prototype.prepare
App.prototype.prepare = function (this: App, ...args) {
  this.http = Requester.create(this.options.request)
  this.plugin(require('@koishijs/plugin-cache-lru'))
  prepare.call(this, ...args)
  prepareServer.call(this)
}

function prepareServer(this: App) {
  this.options.baseDir ||= process.cwd()

  const { port, host } = this.options
  if (!port) return

  // create server
  const koa: Koa = new (require('koa'))()
  this.router = new (require('@koa/router'))()
  koa.use(require('koa-bodyparser')())
  koa.use(this.router.routes())
  koa.use(this.router.allowedMethods())
  defineProperty(this, '_httpServer', createServer(koa.callback()))

  this.on('connect', () => {
    this._httpServer.listen(port, host)
    this.logger('app').info('server listening at %c', `http://${host || 'localhost'}:${port}`)
  })

  this.on('disconnect', () => {
    this.logger('app').info('http server closing')
    this._httpServer?.close()
  })
}



// hack into router methods to make sure
// that koa middlewares are disposable
const register = Router.prototype.register
Router.prototype.register = function (this: Router, ...args) {
  const layer = register.apply(this, args)
  const context: Context = this[Context.current]
  context?.state.disposables.push(() => {
    remove(this.stack, layer)
  })
  return layer
}
