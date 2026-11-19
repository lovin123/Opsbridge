import { SetMetadata } from '@nestjs/common';

export const SKIP_ORIGIN = 'skipOrigin';

export const SkipOrigin = () => SetMetadata(SKIP_ORIGIN, true);
