import { Contract, BigNumber, Signer } from 'ethers'
import type { Event } from 'ethers'
import { isHexString } from '@ethersproject/bytes'
import type { TransactionResponse } from '@ethersproject/abstract-provider'

import { SimpleRecipientRegistry } from './abi'
import { provider, ipfsGatewayUrl } from './core'
import type { Project } from './projects'
import type { RegistryInfo, RecipientApplicationData } from './types'
import { formToRecipientData } from './recipient'

function decodeRecipientAdded(event: Event): Project {
  const args = event.args as any
  const metadata = JSON.parse(args._metadata)
  return {
    id: args._recipientId,
    address: args._recipient,
    name: metadata.name,
    description: metadata.description,
    tagline: metadata.tagline,
    category: metadata.category,
    problemSpace: metadata.problemSpace,
    plans: metadata.plans,
    teamName: metadata.teamName,
    teamDescription: metadata.teamDescription,
    githubUrl: metadata.githubUrl,
    radicleUrl: metadata.radicleUrl,
    websiteUrl: metadata.websiteUrl,
    twitterUrl: metadata.twitterUrl,
    discordUrl: metadata.discordUrl,
    bannerImageUrl: `${ipfsGatewayUrl}/ipfs/${metadata.bannerImageHash}`,
    thumbnailImageUrl: `${ipfsGatewayUrl}/ipfs/${metadata.thumbnailImageHash}`,
    index: args._index.toNumber(),
    isHidden: false,
    isLocked: false,
  }
}

export async function getProjects(registryAddress: string, startTime?: number, endTime?: number): Promise<Project[]> {
  const registry = new Contract(registryAddress, SimpleRecipientRegistry, provider)
  const recipientAddedFilter = registry.filters.RecipientAdded()
  const recipientAddedEvents = await registry.queryFilter(recipientAddedFilter, 0)
  const recipientRemovedFilter = registry.filters.RecipientRemoved()
  const recipientRemovedEvents = await registry.queryFilter(recipientRemovedFilter, 0)
  const projects: Project[] = []
  for (const event of recipientAddedEvents) {
    let project: Project
    try {
      project = decodeRecipientAdded(event)
    } catch {
      // Invalid metadata
      continue
    }
    const addedAt = (event.args as any)._timestamp.toNumber()
    if (endTime && addedAt >= endTime) {
      // Hide recipient if it is added after the end of round
      project.isHidden = true
    }
    const removed = recipientRemovedEvents.find(event => {
      return (event.args as any)._recipientId === project.id
    })
    if (removed) {
      const removedAt = (removed.args as any)._timestamp.toNumber()
      if (!startTime || removedAt <= startTime) {
        // Start time not specified
        // or recipient had been removed before start time
        project.isHidden = true
      } else {
        // Disallow contributions to removed recipient, but don't hide it
        project.isLocked = true
      }
    }
    // TODO: set isHidden to 'true' if project replaces removed project during the round
    projects.push(project)
  }
  return projects
}

export async function getProject(registryAddress: string, recipientId: string): Promise<Project | null> {
  if (!isHexString(recipientId, 32)) {
    return null
  }
  const registry = new Contract(registryAddress, SimpleRecipientRegistry, provider)
  const recipientAddedFilter = registry.filters.RecipientAdded(recipientId)
  const recipientAddedEvents = await registry.queryFilter(recipientAddedFilter, 0)
  if (recipientAddedEvents.length !== 1) {
    // Project does not exist
    return null
  }
  let project
  try {
    project = decodeRecipientAdded(recipientAddedEvents[0])
  } catch {
    // Invalid metadata
    return null
  }
  const recipientRemovedFilter = registry.filters.RecipientRemoved(recipientId)
  const recipientRemovedEvents = await registry.queryFilter(recipientRemovedFilter, 0)
  if (recipientRemovedEvents.length !== 0) {
    // Disallow contributions to removed recipient
    project.isLocked = true
  }
  // TODO: set isHidden to 'true' if project was removed before the beginning of the round
  // TODO: set isHidden to 'true' if project was added after the end of round
  return project
}

async function getRegistryInfo(registryAddress: string): Promise<RegistryInfo> {
  const registry = new Contract(registryAddress, SimpleRecipientRegistry, provider)

  let recipientCount
  try {
    recipientCount = await registry.getRecipientCount()
  } catch {
    // older BaseRecipientRegistry contract did not have recipientCount
    // set it to zero as this information is only
    // used during current round for space calculation
    recipientCount = BigNumber.from(0)
  }
  const owner = await registry.owner()

  // deposit, depositToken and challengePeriodDuration are only relevant to the optimistic registry
  return {
    deposit: BigNumber.from(0),
    depositToken: '',
    challengePeriodDuration: 0,
    recipientCount: recipientCount.toNumber(),
    owner,
  }
}

async function addRecipient(
  registryAddress: string,
  recipientApplicationData: RecipientApplicationData,
  signer: Signer,
): Promise<TransactionResponse> {
  const registry = new Contract(registryAddress, SimpleRecipientRegistry, signer)
  const recipientData = formToRecipientData(recipientApplicationData)
  const { address, ...metadata } = recipientData
  const transaction = await registry.addRecipient(address, JSON.stringify(metadata))
  return transaction
}

export default { getProjects, getProject, getRegistryInfo, addRecipient }
