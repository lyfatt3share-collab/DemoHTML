// Demo in-memory store
window.Store = {
  jobs: [
    {
      id: "JOB-001",
      plate: "SGX1234A",
      customerType: "Guest",
      status: "CREATED"
    }
  ],

  createJob(plate, customerType) {
    this.jobs.push({
      id: "JOB-" + Date.now(),
      plate,
      customerType,
      status: "CREATED"
    });
  },

  getAvailableJobs() {
    return this.jobs.filter(j => j.status === "CREATED");
  },

  getJob(id) {
    return this.jobs.find(j => j.id === id);
    },
};

