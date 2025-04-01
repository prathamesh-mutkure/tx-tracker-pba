import type {
  API,
  FinalizedEvent,
  IncomingEvent,
  NewBlockEvent,
  NewTransactionEvent,
  OutputAPI,
  Settled,
} from "../types"

type SettledTxn = Settled & {
  txn: string
}

export default function prathamesh_mutkure(api: API, outputApi: OutputAPI) {
  let lastFinalisedBlock: string | null = null
  let allTransactions: string[] = []

  const settledBlocks: Map<string, string[]> = new Map()
  const settledTxnsForBlock: Map<string, SettledTxn[]> = new Map()

  // Requirements:
  //
  // 1) When a transaction becomes "settled"-which always occurs upon receiving a "newBlock" event-
  //    you must call `outputApi.onTxSettled`.
  //
  //    - Multiple transactions may settle in the same block, so `onTxSettled` could be called
  //      multiple times per "newBlock" event.
  //    - Ensure callbacks are invoked in the same order as the transactions originally arrived.
  //
  // 2) When a transaction becomes "done"-meaning the block it was settled in gets finalized-
  //    you must call `outputApi.onTxDone`.
  //
  //    - Multiple transactions may complete upon a single "finalized" event.
  //    - As above, maintain the original arrival order when invoking `onTxDone`.
  //    - Keep in mind that the "finalized" event is not emitted for all finalized blocks.
  //
  // Notes:
  // - It is **not** ok to make redundant calls to either `onTxSettled` or `onTxDone`.
  // - It is ok to make redundant calls to `getBody`, `isTxValid` and `isTxSuccessful`
  //
  // Bonus 1:
  // - Avoid making redundant calls to `getBody`, `isTxValid` and `isTxSuccessful`.
  //
  // Bonus 2:
  // - Upon receiving a "finalized" event, call `api.unpin` to unpin blocks that are either:
  //     a) pruned, or
  //     b) older than the currently finalized block.

  const onNewBlock = ({ blockHash, parent }: NewBlockEvent) => {
    console.log("New block", blockHash)

    if (!lastFinalisedBlock) {
      lastFinalisedBlock = parent
    }

    // Is this block the descendant of a "settled block"?
    const isDescendantOfSettledBlock = settledBlocks.has(parent)

    settledBlocks.set(parent, [...(settledBlocks.get(parent) ?? []), blockHash])

    if (isDescendantOfSettledBlock) {
      // Yes - ignore
    } else {
      // No - Is the transaction present in the body?
      const body = api.getBody(blockHash)

      for (let txn in allTransactions) {
        const isTxnPresentInBody = body.includes(txn)

        if (isTxnPresentInBody) {
          // Yes
          // Check if the transaction was successful
          // Flag the tx for this block as "settled successful/unsuccessful"
          const isTxnSuccessful = api.isTxSuccessful(blockHash, txn)

          const settledTxn: SettledTxn = {
            txn,
            blockHash,
            successful: isTxnSuccessful,
            type: "valid",
          }

          outputApi.onTxSettled(txn, settledTxn)

          settledTxnsForBlock.set(blockHash, [
            ...(settledTxnsForBlock.get(blockHash) ?? []),
            settledTxn,
          ])

          allTransactions = allTransactions.filter((tx) => tx !== txn)
        } else {
          // No

          // Is it valid in this block?
          const isTxValidInThisBlock = api.isTxValid(blockHash, txn)
          const isTxnSuccessful = api.isTxSuccessful(blockHash, txn)

          if (isTxValidInThisBlock) {
            // Yes
            // ignore
          } else {
            // Flag the tx for this block as "settled invalid".
            outputApi.onTxSettled(txn, {
              blockHash,
              type: "invalid",
            })

            const txnData: SettledTxn = {
              txn,
              blockHash,
              successful: isTxnSuccessful,
              type: isTxValidInThisBlock ? "valid" : "invalid",
            }

            settledTxnsForBlock.set(blockHash, [
              ...(settledTxnsForBlock.get(blockHash) ?? []),
              txnData,
            ])

            allTransactions = allTransactions.filter((tx) => tx !== txn)
          }
        }
      }
    }
  }

  const onNewTx = ({ value: transaction }: NewTransactionEvent) => {
    allTransactions.push(transaction)
  }

  function getAllDescendants(
    settledBlocks: Map<string, string[]>,
    currentFinalized: string,
    lastFinalized: string,
  ): string[] {
    const path: string[] = []
    let block = currentFinalized

    while (block !== lastFinalized) {
      path.push(block)

      // Find the parent of the current block
      let parentFound = false
      for (const [parent, children] of settledBlocks.entries()) {
        if (children.includes(block)) {
          block = parent
          parentFound = true
          break
        }
      }

      if (!parentFound) break // Stop if no parent is found (invalid path)
    }

    return path
  }

  const onFinalized = ({ blockHash }: FinalizedEvent) => {
    console.log("Finalized", blockHash)

    const finalisedBlocks = getAllDescendants(
      settledBlocks,
      blockHash,
      lastFinalisedBlock!,
    )

    for (let block of finalisedBlocks) {
      const onGoingTxnsForBlocks = settledTxnsForBlock.get(block) ?? []

      onGoingTxnsForBlocks.forEach((txn) => {
        outputApi.onTxDone(txn.txn, {
          blockHash: txn.blockHash,
          ...(txn.type === "invalid"
            ? { type: "invalid" }
            : { type: "valid", successful: txn.successful }),
        })
      })

      settledTxnsForBlock.delete(block)
    }

    lastFinalisedBlock = blockHash
  }

  return (event: IncomingEvent) => {
    switch (event.type) {
      case "newBlock": {
        onNewBlock(event)
        break
      }
      case "newTransaction": {
        onNewTx(event)
        break
      }
      case "finalized":
        onFinalized(event)
    }
  }
}
