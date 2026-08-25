import 'reflect-metadata';
import 'dotenv/config';
import { loadConfig } from '../config';
import { createDataSource } from './data-source';

export default createDataSource(loadConfig());
