import { ConsoleSink, Logger } from '@strata/core'

export const logger = new Logger(new ConsoleSink(), 'editor', 'info')
