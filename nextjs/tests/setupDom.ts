// Adds jest-dom custom matchers (toBeInTheDocument, toHaveTextContent, etc.)
// to every jsdom test. Runs after the Jest framework initialises so the
// expect object is already available when this file executes.
//
// The /jest-globals entry point is the one that augments the `expect` imported
// from '@jest/globals'. The bare import only augments the ambient global, which
// tests in this repo do not use.
import '@testing-library/jest-dom/jest-globals';
