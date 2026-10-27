import type { BallistixView } from '../view';
import { enemyView } from './enemy';
import { enginesView } from './engines';
import { magnetView } from './magnet';
import { platformView } from './platform';
import { repelView } from './repel';

/** Variant feature views, drawn in this order. Add a new variant's view here. */
export const BALLISTIX_VIEWS: BallistixView[] = [platformView, enemyView, repelView, enginesView, magnetView];
