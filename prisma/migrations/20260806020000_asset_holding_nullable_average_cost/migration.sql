-- Allow opening crypto positions with unknown historical average cost (MXN).
-- Market value remains quantity × latest price; cost basis / unrealized P&L stay unavailable until cost is provided.
ALTER TABLE "asset_holdings" ALTER COLUMN "averageCostMxn" DROP NOT NULL;
