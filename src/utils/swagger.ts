import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import type { Request, Response, NextFunction } from 'express';
import { openApiConfig } from '../config/openapi.js';
import { logger } from './logger.js';

// Generate OpenAPI specification from JSDoc comments
export const generateOpenApiSpec = () => {
  try {
    // Configure swagger-jsdoc
    const options = {
      definition: {
        ...openApiConfig,
      },
      // Paths to files containing OpenAPI definitions
      apis: [
        './src/routes/**/*.ts',
        './src/routes/**/*.js',
        './src/models/**/*.ts',
        './src/models/**/*.js',
      ],
    };

    // Generate the OpenAPI specification
    const specs = swaggerJsdoc(options);
    return specs;
  } catch (error) {
    logger.error('Failed to generate OpenAPI specification', { error });
    throw new Error('Failed to generate API documentation');
  }
};

// Middleware to serve Swagger UI
export const serveSwaggerUI = () => {
  const specs = generateOpenApiSpec();
  
  return [
    // Serve Swagger UI at /api-docs
    swaggerUi.serve,
    // Setup Swagger UI with our OpenAPI specification
    swaggerUi.setup(specs, {
      explorer: true,
      customSiteTitle: 'MCP Command Center API Documentation',
      customCss: '.swagger-ui .topbar { display: none }',
      customfavIcon: '/favicon.ico',
      // Add description as a custom JS variable since it's not a valid option
      swaggerOptions: {
        docExpansion: 'list',
        filter: true,
        showRequestDuration: true,
      },
    }),
    // Error handler
    (err: Error, req: Request, res: Response, next: NextFunction) => {
      if (err) {
        logger.error('Swagger UI error', { error: err.message });
        res.status(500).json({
          success: false,
          error: 'Failed to load API documentation',
        });
      } else {
        next();
      }
    },
  ];
};

// Middleware to serve raw OpenAPI JSON
export const serveOpenApiJson = (req: Request, res: Response) => {
  try {
    const specs = generateOpenApiSpec();
    res.json(specs);
  } catch (error) {
    logger.error('Failed to serve OpenAPI JSON', { error });
    res.status(500).json({
      success: false,
      error: 'Failed to generate API documentation',
    });
  }
};
