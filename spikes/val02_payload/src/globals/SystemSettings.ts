import type { GlobalConfig } from 'payload'

export const SystemSettings: GlobalConfig = {
  slug: 'system-settings',
  access: { read: () => true, update: () => false },
  fields: [
    { name: 'showAdultImages', type: 'checkbox', defaultValue: false, required: true },
    {
      name: 'galleryPageSize',
      type: 'number',
      defaultValue: 16,
      max: 100,
      min: 1,
      required: true,
    },
    { name: 'publicReadEnabled', type: 'checkbox', defaultValue: true, required: true },
  ],
}
