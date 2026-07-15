import {
  Forbidden,
  type Access,
  type CollectionBeforeOperationHook,
  type CollectionConfig,
} from 'payload'

const authenticated: Access = ({ req }) => Boolean(req.user)
export const denyAnonymousTechnicalUserCreation: CollectionBeforeOperationHook = ({
  operation,
  req,
}) => {
  if (operation === 'create' && !req.user) throw new Forbidden(req.t)
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    lockTime: 10 * 60 * 1_000,
    maxLoginAttempts: 5,
  },
  access: {
    create: authenticated,
    delete: authenticated,
    read: authenticated,
    update: authenticated,
  },
  fields: [],
  hooks: {
    beforeOperation: [denyAnonymousTechnicalUserCreation],
  },
}
