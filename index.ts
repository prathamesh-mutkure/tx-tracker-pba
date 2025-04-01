import inputData from "./src/input.json"
import expectedResult from "./src/output.json"
import { evaluateSolution } from "./src/evaluate"
import solution from "./src/solutions/template"
import solution2 from "./src/solutions/prathamesh-mutkure"

const solver = evaluateSolution(inputData as any, expectedResult as any)
const score = solver(solution2)
console.log("SCORE: ", score)
