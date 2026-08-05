import type { Collection, Document } from 'mongodb'
import type { Deploymentum, DeploymentumStore } from '../types/deploymentum.js'

function fromDoc(doc: Document): Deploymentum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Document & { _id: unknown }
  return rest as Deploymentum
}

export class MongoDeploymentum implements DeploymentumStore {
  constructor(private readonly col: Collection) {}

  async upsert(deploymentum: Deploymentum): Promise<void> {
    await this.col.replaceOne({ hash: deploymentum.hash }, deploymentum, { upsert: true })
  }

  async find(hash: string): Promise<Deploymentum | null> {
    const doc = await this.col.findOne({ hash })
    return doc ? fromDoc(doc) : null
  }
}
