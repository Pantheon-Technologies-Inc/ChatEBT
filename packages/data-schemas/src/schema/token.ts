import { Schema } from 'mongoose';
import { IToken } from '~/types';

const tokenSchema: Schema<IToken> = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'user',
  },
  email: {
    type: String,
  },
  type: {
    type: String,
  },
  identifier: {
    type: String,
  },
  token: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  metadata: {
    type: Map,
    of: Schema.Types.Mixed,
  },
});

// Remove TTL index completely - handle token cleanup manually to prevent premature deletion
// tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 600 });
tokenSchema.index({ expiresAt: 1 }); // Regular index for queries, no automatic deletion

export default tokenSchema;
