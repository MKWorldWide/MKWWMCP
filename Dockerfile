# Use Node.js LTS with build tools
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache python3 make g++

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install npm packages
RUN npm install

# Bundle app source
COPY . .

# Build the application
RUN npm run build

# Expose the app port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start the application
CMD ["npm", "run", "dev"]
