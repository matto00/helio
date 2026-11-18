# Routes — Ask

`AskRoutes`: `POST /api/dashboards/:id/ask` and `POST /api/outputs/:id/ask` (HEL-1745), authenticated tree only. Thin shell over `AskDataService`; access, tier gate and charge happen here, in that order.
