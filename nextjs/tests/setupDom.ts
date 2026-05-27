// Adds jest-dom custom matchers (toBeInTheDocument, toHaveTextContent, etc.)
// to every jsdom test. Runs after the Jest framework initialises so the
// expect object is already available when this file executes.
import '@testing-library/jest-dom';
