import { PartialType } from '@nestjs/mapped-types';
import { CreateHealthDto } from './create-health.dto.js';

export class UpdateHealthDto extends PartialType(CreateHealthDto) {}
