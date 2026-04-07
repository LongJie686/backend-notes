# Collaborative Filtering

## Core Idea

> Users who agreed in the past will agree in the future.

## User-based CF

1. Find similar users (cosine similarity / Pearson correlation)
2. Predict rating = weighted average of similar users' ratings
3. Recommend top-N items

```
sim(u, v) = cos(r_u, r_v) = (r_u . r_v) / (|r_u| * |r_v|)
```

## Item-based CF

1. Find similar items based on user behavior
2. User's historical preference + item similarity -> predict

Amazon uses this approach.

## Matrix Factorization

Decompose user-item matrix R into:

```
R ≈ P * Q^T
```

- P: user latent factor matrix (m x k)
- Q: item latent factor matrix (n x k)
- k: latent dimension

### SGD Training

```python
for epoch in range(epochs):
    for u, i, r in ratings:
        pred = P[u] @ Q[i]
        error = r - pred
        P[u] += lr * (error * Q[i] - reg * P[u])
        Q[i] += lr * (error * P[u] - reg * Q[i])
```

## Evaluation Metrics

| Metric | Description |
|--------|-------------|
| RMSE | Root Mean Square Error |
| Precision@K | Relevance ratio in top-K |
| Recall@K | Coverage of relevant items |
| NDCG@K | Position-weighted relevance |
| Hit Rate | At least one hit in top-K |

## Cold Start Solutions

- New User: Popularity-based / content-based bootstrap
- New Item: Content features / ask for initial ratings
